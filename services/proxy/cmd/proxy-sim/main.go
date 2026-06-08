package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/taxonomy"
	"github.com/getcustoms/proxy/internal/wal"
)

type simConfig struct {
	url           string
	proxyID       string
	proxySecret   string
	projectToken  string
	pkgNamespace  string
	scenario      string
	ecosystems    []string
	requests      int
	packages      int
	concurrency   int
	passes        int
	timeout       time.Duration
	usageBatch    int
	contributor   bool
	checkUsage    bool
	checkMetadata bool
	metadataRatio int
	seed          int64
}

type workloadItem struct {
	index     int
	pass      int
	operation string
	ecosystem string
	pkg       string
	version   string
}

type recorder struct {
	mu            sync.Mutex
	stats         map[string]*opStats
	workloadItems int
}

type opStats struct {
	durations []time.Duration
	errors    map[string]int
	decisions map[string]int
}

func main() {
	cfg := parseFlags()

	ctx, cancel := context.WithTimeout(context.Background(), cfg.timeout)
	defer cancel()

	cp := client.New(cfg.url, cfg.proxySecret, cfg.proxyID)
	if _, err := cp.ExchangeRuntimeToken(ctx); err != nil {
		log.Fatalf("runtime token exchange failed: %v", err)
	}

	rec := &recorder{stats: make(map[string]*opStats)}
	started := time.Now()

	for pass := 1; pass <= cfg.passes; pass++ {
		if cfg.passes > 1 {
			log.Printf("starting pass %d/%d", pass, cfg.passes)
		}
		runPass(ctx, cfg, cp, rec, pass)
	}

	printSummary(rec, time.Since(started))
}

func parseFlags() simConfig {
	cfg := simConfig{}
	ecosystems := flag.String("ecosystems", "npm,pypi", "comma-separated ecosystem list: npm,pypi,docker")
	flag.StringVar(&cfg.url, "url", "http://localhost:3000", "control plane API base URL")
	flag.StringVar(&cfg.proxyID, "proxy-id", os.Getenv("PROXY_ID"), "registered proxy ID")
	flag.StringVar(&cfg.proxySecret, "proxy-secret", os.Getenv("PROXY_CONTROL_PLANE_SECRET"), "registered proxy secret")
	flag.StringVar(&cfg.projectToken, "project-token", os.Getenv("PROJECT_TOKEN"), "project token used for Check")
	flag.StringVar(&cfg.pkgNamespace, "package-namespace", "sim", "synthetic package namespace; change per run for cold-cache benchmarks")
	flag.StringVar(&cfg.scenario, "scenario", "check", "scenario: check,latest,used,contributor,usage,mixed")
	flag.IntVar(&cfg.requests, "requests", 1000, "requests per pass")
	flag.IntVar(&cfg.packages, "packages", 1000, "distinct synthetic packages")
	flag.IntVar(&cfg.concurrency, "concurrency", 25, "concurrent workers")
	flag.IntVar(&cfg.passes, "passes", 1, "repeat the same workload N times")
	flag.DurationVar(&cfg.timeout, "timeout", 5*time.Minute, "overall simulator timeout")
	flag.IntVar(&cfg.usageBatch, "usage-batch", 25, "events sent per RecordUsage stream operation")
	flag.BoolVar(&cfg.contributor, "contributor-context", true, "include contributor context on npm Check calls")
	flag.BoolVar(&cfg.checkUsage, "record-check-usage", true, "record a matching artifact usage event after each successful Check")
	flag.BoolVar(&cfg.checkMetadata, "record-check-metadata", true, "record latest and used-version metadata after each successful Check")
	flag.IntVar(&cfg.metadataRatio, "metadata-ratio", 20, "mixed scenario percent allocated to metadata RPCs")
	flag.Int64Var(&cfg.seed, "seed", 1, "random seed for mixed operation ordering")
	flag.Parse()

	cfg.ecosystems = splitList(*ecosystems)
	if cfg.proxyID == "" || cfg.proxySecret == "" || cfg.projectToken == "" {
		log.Fatal("proxy-id, proxy-secret, and project-token are required")
	}
	if cfg.requests <= 0 || cfg.packages <= 0 || cfg.concurrency <= 0 || cfg.passes <= 0 {
		log.Fatal("requests, packages, concurrency, and passes must be positive")
	}
	if cfg.usageBatch <= 0 {
		log.Fatal("usage-batch must be positive")
	}
	return cfg
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	if len(out) == 0 {
		return []string{taxonomy.EcosystemNPM}
	}
	return out
}

func runPass(ctx context.Context, cfg simConfig, cp *client.Client, rec *recorder, pass int) {
	jobs := make(chan workloadItem)
	var wg sync.WaitGroup

	for worker := 0; worker < cfg.concurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				runItem(ctx, cfg, cp, rec, item)
			}
		}()
	}

	rng := rand.New(rand.NewSource(cfg.seed + int64(pass)))
	for i := 0; i < cfg.requests; i++ {
		ecosystem := cfg.ecosystems[i%len(cfg.ecosystems)]
		item := workloadItem{
			index:     i,
			pass:      pass,
			operation: chooseOperation(cfg, rng, i),
			ecosystem: ecosystem,
			pkg:       packageName(cfg, ecosystem, i%cfg.packages),
			version:   versionFor(cfg, ecosystem, i%cfg.packages),
		}
		if item.operation == "contributor" {
			item.ecosystem = taxonomy.EcosystemNPM
			item.pkg = packageName(cfg, item.ecosystem, i%cfg.packages)
			item.version = versionFor(cfg, item.ecosystem, i%cfg.packages)
		}
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return
		case jobs <- item:
		}
	}
	close(jobs)
	wg.Wait()
}

func chooseOperation(cfg simConfig, rng *rand.Rand, i int) string {
	switch cfg.scenario {
	case "check", "latest", "used", "contributor", "usage":
		return cfg.scenario
	case "mixed":
		roll := rng.Intn(100)
		if roll < cfg.metadataRatio/2 {
			return "latest"
		}
		if roll < cfg.metadataRatio {
			return "used"
		}
		if roll < cfg.metadataRatio+5 {
			return "usage"
		}
		if roll < cfg.metadataRatio+10 {
			return "contributor"
		}
		return "check"
	default:
		if i == 0 {
			log.Printf("unknown scenario %q; using check", cfg.scenario)
		}
		return "check"
	}
}

func runItem(ctx context.Context, cfg simConfig, cp *client.Client, rec *recorder, item workloadItem) {
	start := time.Now()
	decision := ""
	err := doItem(ctx, cfg, cp, rec, item, &decision)
	rec.record(item.operation, time.Since(start), decision, err)
	rec.recordWorkloadItem()
}

func doItem(ctx context.Context, cfg simConfig, cp *client.Client, rec *recorder, item workloadItem, decision *string) error {
	observedAt := time.Now().UTC().Format(time.RFC3339)
	switch item.operation {
	case "check":
		checkStarted := time.Now()
		resp, err := cp.Check(ctx, client.CheckRequest{
			ProxyID:             cfg.proxyID,
			ProjectToken:        cfg.projectToken,
			Ecosystem:           item.ecosystem,
			Package:             item.pkg,
			Version:             item.version,
			RequestedRef:        item.version,
			ResolvedRef:         item.version,
			RefResolutionSource: "proxy_sim",
			TraceID:             traceID(),
			RequestID:           requestID(item),
			SpanID:              uuid.NewString(),
			ClientIP:            "127.0.0.1",
			ContributorContext:  contributorContext(cfg, item, observedAt),
		})
		checkDecision := ""
		if err == nil {
			checkDecision = resp.Decision + ":" + resp.Reason
		}
		rec.record("check.rpc", time.Since(checkStarted), checkDecision, err)
		if err == nil {
			*decision = checkDecision
			if cfg.checkUsage {
				started := time.Now()
				if err := recordUsageBatch(ctx, cfg, cp, item, 1, resp.Decision, taxonomy.DecisionPathCheck, resp.TenantID, resp.ProjectID); err != nil {
					rec.record("check.record_usage", time.Since(started), "", err)
					return fmt.Errorf("record check usage: %w", err)
				}
				rec.record("check.record_usage", time.Since(started), "", nil)
			}
			if cfg.checkMetadata {
				started := time.Now()
				if err := recordLatestMetadata(ctx, cp, item, observedAt); err != nil {
					rec.record("check.record_latest_metadata", time.Since(started), "", err)
					return fmt.Errorf("record check latest metadata: %w", err)
				}
				rec.record("check.record_latest_metadata", time.Since(started), "", nil)

				started = time.Now()
				if err := recordUsedVersionMetadata(ctx, cp, item, observedAt); err != nil {
					rec.record("check.record_used_metadata", time.Since(started), "", err)
					return fmt.Errorf("record check used metadata: %w", err)
				}
				rec.record("check.record_used_metadata", time.Since(started), "", nil)

				if item.ecosystem == taxonomy.EcosystemNPM && cfg.contributor {
					started = time.Now()
					if err := cp.RecordPackageContributorMetadata(ctx, contributorMetadata(item, observedAt)); err != nil {
						rec.record("check.record_contributor_metadata", time.Since(started), "", err)
						return fmt.Errorf("record check contributor metadata: %w", err)
					}
					rec.record("check.record_contributor_metadata", time.Since(started), "", nil)
				}
			}
		}
		return err
	case "latest":
		return recordLatestMetadata(ctx, cp, item, observedAt)
	case "used":
		return recordUsedVersionMetadata(ctx, cp, item, observedAt)
	case "contributor":
		return cp.RecordPackageContributorMetadata(ctx, contributorMetadata(item, observedAt))
	case "usage":
		return recordUsageBatch(ctx, cfg, cp, item, cfg.usageBatch, "DECISION_ALLOW", taxonomy.DecisionPathCacheHit, "", "")
	default:
		return fmt.Errorf("unknown operation %q", item.operation)
	}
}

func recordLatestMetadata(ctx context.Context, cp *client.Client, item workloadItem, observedAt string) error {
	return cp.RecordPackageLatestMetadata(ctx, wal.PackageLatestMetadata{
		Ecosystem:         item.ecosystem,
		Package:           item.pkg,
		LatestVersion:     item.version,
		LatestPublishedAt: publishedAt(item.index),
		ObservedAt:        observedAt,
		CacheStatus:       taxonomy.MetadataCacheStatusRefresh,
	})
}

func recordUsedVersionMetadata(ctx context.Context, cp *client.Client, item workloadItem, observedAt string) error {
	return cp.RecordPackageUsedVersionMetadata(ctx, wal.PackageUsedVersionMetadata{
		Ecosystem:              item.ecosystem,
		Package:                item.pkg,
		UsedVersion:            item.version,
		UsedVersionPublishedAt: publishedAt(item.index),
		ObservedAt:             observedAt,
		CacheStatus:            taxonomy.MetadataCacheStatusHit,
		LatestVersion:          item.version,
		LatestPublishedAt:      publishedAt(item.index),
	})
}

func recordUsageBatch(
	ctx context.Context,
	cfg simConfig,
	cp *client.Client,
	item workloadItem,
	count int,
	decision string,
	decisionPath string,
	tenantID string,
	projectID string,
) error {
	stream := cp.OpenEventStream(ctx)
	for i := 0; i < count; i++ {
		event := usageEvent(cfg, item, i, decision, decisionPath, tenantID, projectID)
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	_, err := stream.CloseAndReceive()
	return err
}

func contributorContext(cfg simConfig, item workloadItem, observedAt string) *client.ContributorCheckContext {
	if !cfg.contributor || item.ecosystem != taxonomy.EcosystemNPM {
		return nil
	}
	return &client.ContributorCheckContext{
		RequestedVersion:               item.version,
		SliceExtractedAt:               observedAt,
		SliceWindowDays:                45,
		SliceHistoryComplete:           false,
		SliceOldestIncludedPublishedAt: publishedAt(item.index - 1),
		PackageMetadataFingerprint:     fmt.Sprintf("sim-pkg-%s-%d", item.pkg, item.pass),
		SliceFingerprint:               fmt.Sprintf("sim-slice-%s-%s-%d", item.pkg, item.version, item.pass),
		Versions: []client.ContributorCheckVersion{
			{
				Version:           item.version,
				PublishedAt:       publishedAt(item.index),
				Publisher:         publisherName(item.index),
				Maintainers:       []string{publisherName(item.index)},
				HasInstallScripts: item.index%17 == 0,
				HasAttestation:    item.index%5 == 0,
				RawPayloadJSON:    fmt.Sprintf(`{"name":%q,"version":%q}`, item.pkg, item.version),
			},
		},
	}
}

func contributorMetadata(item workloadItem, observedAt string) wal.PackageContributorMetadata {
	return wal.PackageContributorMetadata{
		Ecosystem:                 item.ecosystem,
		Package:                   item.pkg,
		ExtractedAt:               observedAt,
		Fingerprint:               fmt.Sprintf("sim-pkg-%s-%d", item.pkg, item.pass),
		LatestVersion:             item.version,
		LatestPublishedAt:         publishedAt(item.index),
		HistoryComplete:           false,
		OldestIncludedPublishedAt: publishedAt(item.index - 3),
		Versions: []wal.PackageContributorVersion{
			{
				Version:           item.version,
				PublishedAt:       publishedAt(item.index),
				Publisher:         publisherName(item.index),
				Maintainers:       []string{publisherName(item.index)},
				HasInstallScripts: item.index%17 == 0,
				HasAttestation:    item.index%5 == 0,
				RawPayloadJSON:    fmt.Sprintf(`{"name":%q,"version":%q}`, item.pkg, item.version),
			},
		},
	}
}

func usageEvent(
	cfg simConfig,
	item workloadItem,
	offset int,
	decision string,
	decisionPath string,
	tenantID string,
	projectID string,
) wal.Event {
	serveMode := taxonomy.ServeModeRedirect
	if decision == "DECISION_BLOCK" {
		serveMode = ""
	}
	return wal.Event{
		Ecosystem:           item.ecosystem,
		Package:             item.pkg,
		Version:             item.version,
		Decision:            decision,
		EventType:           taxonomy.RequestEventTypeArtifact,
		DecisionCache:       decisionPath == taxonomy.DecisionPathCacheHit,
		RequestedAt:         time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash:    hashProjectToken(cfg.projectToken),
		TraceID:             traceID(),
		RequestID:           fmt.Sprintf("%s-usage-%d", requestID(item), offset),
		TenantID:            tenantID,
		ProjectID:           projectID,
		ServeMode:           serveMode,
		DecisionPath:        decisionPath,
		DurationMs:          int64(1 + offset%10),
		RequestedRef:        item.version,
		ResolvedRef:         item.version,
		RefResolutionSource: "proxy_sim",
	}
}

func packageName(cfg simConfig, ecosystem string, i int) string {
	namespace := packageNamespace(cfg)
	switch ecosystem {
	case taxonomy.EcosystemNPM:
		return fmt.Sprintf("@%s/pkg-%05d", namespace, i)
	case taxonomy.EcosystemPyPI:
		return fmt.Sprintf("%s-package-%05d", namespace, i)
	case taxonomy.EcosystemDocker:
		return fmt.Sprintf("hub.docker.io/library/%s-image-%05d", namespace, i)
	default:
		return fmt.Sprintf("%s-%s-%05d", namespace, ecosystem, i)
	}
}

func versionFor(cfg simConfig, ecosystem string, i int) string {
	if ecosystem == taxonomy.EcosystemDocker {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s-image-%05d", packageNamespace(cfg), i)))
		return "sha256:" + hex.EncodeToString(sum[:])
	}
	return fmt.Sprintf("1.%d.%d", i%20, i%10)
}

func packageNamespace(cfg simConfig) string {
	namespace := strings.ToLower(strings.TrimSpace(cfg.pkgNamespace))
	if namespace == "" {
		namespace = "sim"
	}
	var b strings.Builder
	for _, r := range namespace {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
			continue
		}
		if r == '_' || r == '.' || r == '/' || r == ':' {
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "sim"
	}
	return out
}

func publishedAt(i int) string {
	if i < 0 {
		i = 0
	}
	return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i%180) * 24 * time.Hour).Format(time.RFC3339)
}

func publisherName(i int) string {
	return fmt.Sprintf("maintainer-%03d", i%50)
}

func traceID() string {
	id := uuid.New()
	return strings.ReplaceAll(id.String(), "-", "")
}

func requestID(item workloadItem) string {
	return fmt.Sprintf("sim-%d-%d", item.pass, item.index)
}

func hashProjectToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *recorder) recordWorkloadItem() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.workloadItems++
}

func (r *recorder) record(op string, duration time.Duration, decision string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	stat := r.stats[op]
	if stat == nil {
		stat = &opStats{
			errors:    make(map[string]int),
			decisions: make(map[string]int),
		}
		r.stats[op] = stat
	}
	stat.durations = append(stat.durations, duration)
	if err != nil {
		stat.errors[err.Error()]++
	}
	if decision != "" {
		stat.decisions[decision]++
	}
}

func printSummary(rec *recorder, total time.Duration) {
	rec.mu.Lock()
	defer rec.mu.Unlock()

	fmt.Printf("total_duration=%s\n", total.Round(time.Millisecond))
	ops := make([]string, 0, len(rec.stats))
	totalSamples := 0
	for op, stat := range rec.stats {
		ops = append(ops, op)
		totalSamples += len(stat.durations)
	}
	sort.Strings(ops)
	if total.Seconds() > 0 {
		fmt.Printf("workload_items=%d\n", rec.workloadItems)
		fmt.Printf("operation_samples=%d\n", totalSamples)
		fmt.Printf("workload_throughput=%.2f items/s\n", float64(rec.workloadItems)/total.Seconds())
		fmt.Printf("observed_operation_throughput=%.2f samples/s\n", float64(totalSamples)/total.Seconds())
	}
	for _, op := range ops {
		stat := rec.stats[op]
		sort.Slice(stat.durations, func(i, j int) bool {
			return stat.durations[i] < stat.durations[j]
		})
		errCount := 0
		for _, count := range stat.errors {
			errCount += count
		}
		fmt.Printf("\n[%s]\n", op)
		fmt.Printf("requests=%d errors=%d\n", len(stat.durations), errCount)
		fmt.Printf("p50=%s p95=%s p99=%s max=%s\n",
			percentile(stat.durations, 0.50),
			percentile(stat.durations, 0.95),
			percentile(stat.durations, 0.99),
			percentile(stat.durations, 1.00),
		)
		printCounts("decisions", stat.decisions)
		printCounts("errors", stat.errors)
	}
}

func percentile(values []time.Duration, p float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	if p >= 1 {
		return values[len(values)-1].Round(time.Millisecond)
	}
	idx := int(float64(len(values)-1) * p)
	return values[idx].Round(time.Millisecond)
}

func printCounts(label string, counts map[string]int) {
	if len(counts) == 0 {
		return
	}
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	fmt.Printf("%s:\n", label)
	for _, key := range keys {
		fmt.Printf("  %d %s\n", counts[key], key)
	}
}

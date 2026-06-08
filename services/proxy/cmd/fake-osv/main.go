package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"time"
)

type queryRequest struct {
	Package struct {
		Name      string `json:"name"`
		Ecosystem string `json:"ecosystem"`
	} `json:"package"`
	Version string `json:"version"`
}

func main() {
	addr := flag.String("addr", ":8099", "listen address")
	latency := flag.Duration("latency", 0, "fixed response latency")
	jitter := flag.Duration("jitter", 0, "additional random response latency")
	errorRate := flag.Float64("error-rate", 0, "fraction of requests returning HTTP 503")
	vulnRate := flag.Float64("vuln-rate", 0, "fraction of requests returning one HIGH vuln")
	seed := flag.Int64("seed", 1, "random seed for jitter and probabilistic responses")
	flag.Parse()

	rng := rand.New(rand.NewSource(*seed))
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/query", func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		if r.Method != http.MethodPost {
			slog.Warn("fake OSV rejected request", "method", r.Method, "path", r.URL.Path, "status", http.StatusMethodNotAllowed)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if *latency > 0 {
			time.Sleep(*latency)
		}
		if *jitter > 0 {
			time.Sleep(time.Duration(rng.Int63n(int64(*jitter))))
		}
		if *errorRate > 0 && rng.Float64() < *errorRate {
			slog.Warn("fake OSV synthetic error", "status", http.StatusServiceUnavailable, "duration_ms", time.Since(started).Milliseconds())
			http.Error(w, "fake osv unavailable", http.StatusServiceUnavailable)
			return
		}

		var req queryRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		w.Header().Set("Content-Type", "application/json")
		hasVuln := shouldReturnVuln(req.Package.Name, req.Version, *vulnRate)
		defer slog.Info(
			"fake OSV query handled",
			"ecosystem", req.Package.Ecosystem,
			"package", req.Package.Name,
			"version", req.Version,
			"vulns", boolToInt(hasVuln),
			"status", http.StatusOK,
			"duration_ms", time.Since(started).Milliseconds(),
		)
		if hasVuln {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"vulns": []map[string]any{
					{
						"id":      fmt.Sprintf("FAKE-OSV-%08x", stableHash(req.Package.Name+"@"+req.Version)),
						"summary": "Synthetic HIGH vulnerability from fake-osv",
						"severity": []map[string]string{
							{
								"type":  "CVSS_V3",
								"score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
							},
						},
						"affected": []map[string]any{
							{
								"package": map[string]string{
									"name":      req.Package.Name,
									"ecosystem": req.Package.Ecosystem,
								},
								"ranges": []map[string]any{
									{
										"type": "SEMVER",
										"events": []map[string]string{
											{"introduced": "0"},
											{"fixed": "999.999.999"},
										},
									},
								},
							},
						},
						"references": []map[string]string{
							{"type": "FIX", "url": "https://example.invalid/fake-osv/fix"},
						},
						"published": "2026-01-01T00:00:00Z",
						"modified":  "2026-01-01T00:00:00Z",
					},
				},
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{"vulns": []any{}})
	})

	slog.Info("fake OSV listening", "addr", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		slog.Error("fake OSV failed", "error", err.Error())
		os.Exit(1)
	}
}

func shouldReturnVuln(pkg string, version string, rate float64) bool {
	if rate <= 0 {
		return false
	}
	if rate >= 1 {
		return true
	}
	return float64(stableHash(pkg+"@"+version)%10000)/10000 < rate
}

func stableHash(value string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return h.Sum32()
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

# depCustoms Architecture

Detailed service-level architecture diagrams. For a high-level overview, see the [README](../README.md).

## Proxy

The proxy is the data-plane entry point. It parses dependency requests, checks local cache, asks the API for policy decisions when needed, and records durable usage events.

```mermaid
flowchart TD
  A[Developer / CI Package Request] --> B[depCustoms Proxy]
  B --> C{Artifact or Metadata?}
  C -->|Metadata| D[Fetch Upstream Metadata]
  D --> E[Rewrite Registry URLs]
  E --> F[Warm Local Metadata / Contributor Cache]
  F --> G[Return Metadata Response]
  C -->|Artifact| H[Parse Ecosystem / Package / Version]
  H --> I{Proxy Cache Hit?}
  I -->|Yes| J[Serve Cached Decision]
  I -->|No| K[Call Control Plane API]
  K --> L{Allow or Block?}
  L -->|Allow| M[Redirect or Pull Artifact]
  L -->|Block| N[Return 403 / Fail Closed]
  J --> O[Write Durable WAL Event]
  M --> O
  N --> O
```

## API (Control Plane)

The API validates proxy identity, resolves policy, evaluates connector intelligence, persists normalized facts, and records decisions.

```mermaid
flowchart TD
  A[Proxy Request] --> B[Gateway / ConnectRPC]
  B --> C[Proxy Auth + Tenant Binding]
  C --> D[Token / Project Resolution]
  D --> E[Load Effective Policy]
  E --> F[Load or Build Connector Snapshots]
  F --> G[Evaluate Rules]
  G --> H{Decision}
  H -->|Allow| I[Return TTL + Serve Mode]
  H -->|Block| J[Return Block Reason]
  F --> K[Persist Normalized Facts]
  G --> L[Write Violations / Findings / Events]
```

## Dashboard

The dashboard is the operator-facing control surface. It manages tenant configuration, projects, policies, findings, package intelligence, and proxy operations.

```mermaid
flowchart TD
  A[User] --> B[Dashboard]
  B --> C[Auth / Tenant Context]
  C --> D[Projects]
  C --> E[Policies]
  C --> F[Findings / Violations]
  C --> G[Packages / Security Views]
  C --> H[Proxies]
  D --> I[REST / SSE to API]
  E --> I
  F --> I
  G --> I
  H --> I
```

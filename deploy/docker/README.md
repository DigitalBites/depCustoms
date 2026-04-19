# All-In-One Deployment

This directory contains the bundled local deployment for the Customs stack.

This mode is intended for quick evaluation and local bring-up. It is not the
preferred deployment model for production or more realistic operations. The
bundled image exists so you can get Customs running quickly and try the product
with minimal setup.

It runs:

- the API
- the dashboard
- the proxy
- Supabase Auth (GoTrue)
- a Caddy HTTPS front door

## Quick Start

POC scope note:

- This bundled deployment is intended for evaluation and short-lived POC use.
- You should assume the environment is disposable.
- We do not provide support for preserving, migrating, or recovering data created in this mode.
- If you want durable data handling, treat this deployment as a trial path only and plan for a more production-oriented setup later.

1. Make sure you have:
   - Docker
   - Docker Compose
2. Create your local config:

```bash
cd deploy/docker/all-in-one
cp .env.example .env.local
```

3. Set at least these values in `.env.local`:

```bash
ALL_IN_ONE_DATABASE_URL=postgresql://...
ALL_IN_ONE_CADDY_HTTPS_HOST=<host-or-ip>
ALL_IN_ONE_CADDY_HTTPS_PORT=8443
ALL_IN_ONE_REPO_HTTPS_PORT=8442
ALL_IN_ONE_PUBLIC_ORIGIN=https://<host-or-ip>:8443
ALL_IN_ONE_PROXY_PUBLIC_BASE_URL=https://<host-or-ip>:8442
```

4. Export the env file and start the stack:

```bash
source ./export.env.sh
docker compose up --build
```

5. Open the initial setup flow:

```text
https://<host-or-ip>:8443/setup
```

6. After setup:
   - sign in to the dashboard on `https://<host-or-ip>:8443`
   - use `https://<host-or-ip>:8442` for HTTPS repository traffic
   - use `http://<host-or-ip>:8080` only for low-level direct proxy debugging

## Requirements

Before starting the bundled stack, you need:

- Docker
- Docker Compose

The all-in-one container does not bundle Postgres. You must provide an external
database connection via `ALL_IN_ONE_DATABASE_URL`.

## Files

- [docker-compose.yml](all-in-one/docker-compose.yml)
- [Dockerfile](all-in-one/Dockerfile)
- [entrypoint.sh](all-in-one/entrypoint.sh)
- [healthcheck.sh](all-in-one/healthcheck.sh)
- [Caddyfile](all-in-one/Caddyfile)
- [.env.example](all-in-one/.env.example)
- [export.env.sh](all-in-one/export.env.sh)
- [mcp-setup-crt.sh](all-in-one/mcp-setup-crt.sh)

## Configuration

The important environment variables for this deployment are documented in
[.env.example](all-in-one/.env.example).

`export.env.sh` prefers `.env.local`, falls back to `.env`, and exits with an
error if neither file exists.

The most important required values are:

- `ALL_IN_ONE_DATABASE_URL`
- `ALL_IN_ONE_CADDY_HTTPS_HOST`
- `ALL_IN_ONE_CADDY_HTTPS_PORT`
- `ALL_IN_ONE_REPO_HTTPS_PORT`
- `ALL_IN_ONE_PUBLIC_ORIGIN`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_PASSWORD`

Relevant auth/session defaults are also configurable via env:

- `GOTRUE_JWT_EXP=3600` seconds
- `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=2h`
- `GOTRUE_SESSIONS_TIMEBOX=10h`

## Usage

The bundled stack exposes:

- dashboard, API, auth, and MCP on `https://<host>:8443`
- repository traffic over HTTPS on `https://<host>:8442`
- the raw proxy directly on `http://<host>:8080` for low-level debugging

Use the Quick Start flow above for the initial bring-up.

## Initial Setup

After the stack is running, open the dashboard setup flow:

```text
https://<host>:8443/setup
```

That setup flow is the intended first-run entrypoint for:

- creating the initial tenant
- creating the initial owner account
- completing the bundled bootstrap flow in the UI

After setup completes, you can:

- sign in to the dashboard on `https://<host>:8443`
- create project tokens for the npm example
- connect MCP clients against the same bundled origin

## HTTPS Behavior

By default, Caddy:

- serves HTTPS with a locally generated certificate via `tls internal`
- redirects HTTP traffic to the configured HTTPS origin
- serves `root.crt` so local clients can trust the generated CA should you choose
- fronts the repo proxy on a separate HTTPS port

The canonical public origin is determined from:

- `ALL_IN_ONE_CADDY_HTTPS_HOST`
- `ALL_IN_ONE_CADDY_HTTPS_PORT`
- optionally `ALL_IN_ONE_PUBLIC_ORIGIN` if you want to override the derived value

The canonical public repo URL is determined from:

- `ALL_IN_ONE_CADDY_HTTPS_HOST`
- `ALL_IN_ONE_REPO_HTTPS_PORT`
- optionally `ALL_IN_ONE_PROXY_PUBLIC_BASE_URL` if you want to override the derived value

Example:

```bash
ALL_IN_ONE_CADDY_HTTPS_HOST=<host or ip> \
ALL_IN_ONE_CADDY_HTTPS_PORT=8443 \
ALL_IN_ONE_PUBLIC_ORIGIN=https://<host or ip>:8443 \
ALL_IN_ONE_REPO_HTTPS_PORT=8442 \
ALL_IN_ONE_PROXY_PUBLIC_BASE_URL=https://<host or ip>:8442 \
GOTRUE_JWT_EXP=3600 \
GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=2h \
GOTRUE_SESSIONS_TIMEBOX=10h \
docker compose up --build
```

## Auth Session Defaults

The bundled GoTrue instance currently starts with these defaults:

- access token lifetime: `GOTRUE_JWT_EXP=3600` seconds (`1 hour`)
- inactivity timeout: `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=2h`
- absolute session timebox: `GOTRUE_SESSIONS_TIMEBOX=10h`

This means:

- access tokens expire after `1 hour`
- inactive sessions expire after `2 hours`
- active sessions are still capped at `10 hours` total lifetime

These values can be overridden through the environment if your deployment
requires a different session posture.

## MCP Helper

Use [mcp-setup-crt.sh](all-in-one/mcp-setup-crt.sh) to fetch
the Caddy root CA and prepare your shell for MCP clients. This will set two
environment variables to help validate the self-signed cert that Caddy generates.

Run it with:

```bash
source ./mcp-setup-crt.sh <host> <port>
```

Example:

```bash
source ./mcp-setup-crt.sh <host or ip> 8443
```

On success it:

- downloads `https://<host>:<port>/root.crt`
- writes `depCustoms-root.crt` in the current directory
- exports:
  - `SSL_CERT_FILE`
  - `NODE_EXTRA_CA_CERTS`

It also prints example MCP setup commands for Codex and Claude Code.

## npm Example

The repository includes a runnable npm demo at
[examples/npm-oss-packages](../../examples/npm-oss-packages).

The intended flow is:

```bash
cd <repo_root>/docker/all-in-one
source ./export.env.sh
docker compose up --build
```

Then, in a second shell:

```bash
cd <repo_root>/examples/npm-oss-packages
./test-basic.sh
```

or:

```bash
cd <repo_root>/examples/npm-oss-packages
./test-advanced.sh
```

On first run, the helper will:

- prompt for the registry URL, typically `https://<host>:8442`
- prompt for a project token from the dashboard
- create a local [`.npmrc`](../../examples/npm-oss-packages/.npmrc)
- if the registry is HTTPS, fetch `https://<host>:8442/root.crt`
- inspect that certificate to confirm it looks like the bundled local Caddy root
- ask you to confirm before trusting it for the demo
- write `cafile=...` into the demo `.npmrc`

The demo keeps its generated artifacts under
[examples/npm-oss-packages/data](../../examples/npm-oss-packages/data),
and forces npm to use the demo-local `.npmrc` so it does not depend on your
global npm configuration.

## Verification

After startup, verify the bundled stack from your workstation.

### Basic health

```bash
curl -sk https://<host>:8443/root.crt >/dev/null
curl -sk https://<host>:8443/.well-known/oauth-protected-resource/mcp | jq .
curl -sk https://<host>:8443/.well-known/oauth-authorization-server/mcp | jq .
curl -skI https://<host>:8442/ | head
```

The MCP protected-resource metadata should advertise your public HTTPS origin,
for example:

```json
{
  "resource": "https://<host>:8443/mcp",
  "authorization_servers": ["https://<host>:8443"]
}
```

The authorization-server metadata should also use that same public origin for:

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`
- `registration_endpoint`

### `.well-known` metadata expectations

If you connect to:

```text
https://<host or ip>:8443/mcp
```

then these endpoints must consistently return `https://<host or ip>:8443/...`
and not an internal address like `http://127.0.0.1:3000/...` or an IP variant
that does not match what the client is actually using:

```bash
curl -sk https://<host or ip>:8443/.well-known/oauth-protected-resource/mcp
curl -sk https://<host or ip>:8443/.well-known/oauth-authorization-server/mcp
curl -sk https://<host or ip>:8443/mcp/.well-known/openid-configuration
```

The origin in the returned metadata must exactly match what the MCP client uses.

### Repo HTTPS expectations

If your clients are pointed at:

```text
https://<host or ip>:8442/
```

then the proxy should advertise and accept that same base URL. Check:

```bash
curl -skI https://<host or ip>:8442/
curl -sI http://<host or ip>:8080/
```

Expected behavior:

- `8442` terminates TLS in Caddy and forwards to the bundled proxy
- `8080` remains available as the direct non-TLS proxy path
- the proxy public base URL should be `https://<host or ip>:8442` unless you intentionally override it

## Notes

- GoTrue listens internally on `127.0.0.1:9999`.
- The API proxies `/auth/v1/*` and OAuth-related endpoints to GoTrue.
- The dashboard uses the same public origin through Caddy, while its server-side
  auth/session work is routed internally by the bundled entrypoint.
- Caddy forwards repo traffic on `8442` to the proxy on internal port `8080`.
- The image builds GoTrue from the vendored `third_party/supabase-auth` subtree.

## Troubleshooting

### MCP auth starts but fails with protected-resource mismatch

Symptom:

- the MCP client reports a protected resource mismatch between `http` and `https`
- or between hostname and IP

Check the `.well-known` metadata in the Verification section above and confirm
the returned origins exactly match what the MCP client is using.

Fix:

- set `ALL_IN_ONE_CADDY_HTTPS_HOST` to the hostname clients will actually use
- set `ALL_IN_ONE_CADDY_HTTPS_PORT` correctly
- set `ALL_IN_ONE_PUBLIC_ORIGIN` to the exact public origin when in doubt
- make sure the client machine resolves that hostname to the correct IP

### MCP authentication succeeds but reconnect fails

Symptom:

- browser auth succeeds
- MCP client says authentication succeeded, but reconnecting to the server fails

Cause:

- `/mcp` is being routed to the dashboard instead of the API

Check Caddy logs for:

- `POST /mcp` going to `app:3000` is correct
- `POST /mcp` going to `app:3001` is wrong

### UI login succeeds but the dashboard still fails server-side

Symptom:

- `/auth/v1/token` succeeds
- dashboard middleware or SSR logs show `Error: fetch failed`

Cause:

- the dashboard server runtime is trying to call the public HTTPS auth origin
  from inside the container instead of using the internal API origin

Expected bundled behavior:

- browser uses the public HTTPS origin
- dashboard server runtime uses the internal API URL

### Certificate trust problems for MCP clients

Symptom:

- TLS or certificate validation errors from Codex or Claude Code

Fix:

```bash
cd deploy/docker/all-in-one
source ./mcp-setup-crt.sh <host> <port>
```

Then verify:

```bash
echo "$SSL_CERT_FILE"
echo "$NODE_EXTRA_CA_CERTS"
ls -l depCustoms-root.crt
```

### Repo traffic should use HTTPS on `8442`, not the dashboard origin

Symptom:

- npm or other repo clients are pointed at `8443` and behavior is confusing
- repo traffic works on `8080` but not on the intended HTTPS endpoint

Expected bundled behavior:

- `8443` is for dashboard, API, auth, and MCP
- `8442` is for HTTPS repo traffic through Caddy
- `8080` is the direct proxy path kept for debugging

Check the repo HTTPS expectations in the Verification section above.

### npm example bootstrap

You can also verify the npm-specific TLS path directly before running the demo:

```bash
curl -sk https://<host>:8442/root.crt -o /tmp/depCustoms-root.crt
openssl x509 -in /tmp/depCustoms-root.crt -noout -subject -issuer -dates
```

The subject and issuer should look like the bundled local Caddy root CA, for
example `Caddy Local Authority - ... Root`.

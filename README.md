# OpenClaw development image

This image stays close to the official OpenClaw container and adds a compact
development toolchain:

- the Node.js, npm, Git, curl, and native MCP support already in OpenClaw
- Python 3 with pip, venv support, headers, and common build tools
- .NET 10 SDK
- GitHub CLI (`gh`) with runtime `GH_TOKEN` support for both `gh` and HTTPS Git
- `jq`, OpenSSH client, ripgrep, zip, and unzip

The base image is pinned to the current stable OpenClaw release,
`ghcr.io/openclaw/openclaw:2026.7.1`. The explicit release tag avoids silently
using an older build if the upstream mutable `latest` tag lags behind GitHub.

## Configure

Copy `.env.example` to `.env`, then replace the two OpenClaw placeholders:

```powershell
Copy-Item .env.example .env
```

On Linux or macOS, use `cp .env.example .env`.

- `OPENCLAW_GATEWAY_TOKEN`: generate a long random value.
- `GH_TOKEN`: use a fine-grained GitHub PAT scoped to the repositories agents
  need. The token is injected at runtime and is never baked into the image.

Create the three directories from `.env`. On Linux, make them writable by the
container's non-root user:

```bash
mkdir -p .openclaw-data/openclaw-dev/config \
  .openclaw-data/openclaw-dev/workspace \
  .openclaw-data/openclaw-dev/auth-profile-secrets
sudo chown -R 1000:1000 .openclaw-data
```

Docker Desktop file sharing handles these relative paths on Windows and macOS.

## Build and onboard

Build from a fresh copy of the current official image:

```bash
docker compose build --pull
```

Run onboarding through the gateway image before starting the stack:

```console
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js onboard --mode local --no-install-daemon
```

Choose **OpenAI Codex OAuth** for subscription authentication. In a headless
flow, open the displayed URL in a browser and paste the full redirect URL back
into the wizard. No `OPENAI_API_KEY` is required.

Apply the Docker gateway defaults and start it:

```console
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js config set gateway.mode local
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js config set gateway.bind lan
docker compose up -d openclaw-gateway
```

Open <http://127.0.0.1:18789/> and enter `OPENCLAW_GATEWAY_TOKEN`.

## Tailscale sidecar

The optional override gives each deployment its own Tailscale node, MagicDNS
name, HTTPS endpoint, and persistent identity. OpenClaw shares the sidecar's
network namespace but remains bound to loopback. Tailscale Serve proxies it at
`https://<TS_HOSTNAME>.<tailnet-name>.ts.net/`; no OpenClaw ports are published
on the Docker host.

The override requires Docker Compose 2.24.4 or newer and a host that exposes
`/dev/net/tun`. Only the Tailscale sidecar receives `NET_ADMIN` and `NET_RAW`.

In the Tailscale admin console:

1. Enable MagicDNS and HTTPS for the tailnet.
2. Create a reusable, non-ephemeral auth key. Prefer a tagged key with ACLs
   limited to only the tailnet services these agents need.
3. Set `TAILSCALE_AUTH_KEY` in `.env`. Keep `TS_HOSTNAME` unique.

Start the sidecar deployment:

```console
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec tailscale tailscale status
```

The current node's fully qualified `.ts.net` name appears in
`tailscale status`. Open its HTTPS URL and enter `OPENCLAW_GATEWAY_TOKEN`. The
Serve configuration explicitly disables Funnel, so the endpoint remains
tailnet-only. The same shared network namespace and Tailscale DNS configuration
let agents resolve and connect to other permitted MagicDNS nodes. Set
`TS_EXTRA_ARGS=--accept-routes` only when they also need advertised subnet
routes.

The Tailscale key is used by the sidecar but explicitly blanked from the
OpenClaw gateway and agent containers. Gateway token authentication remains
enabled; this sidecar design does not grant the OpenClaw container access to
the Tailscale daemon socket or CLI for identity-header authentication.

### Multiple independent deployments

Use one env file and Compose project name per deployment. For example, copy
`.env.example` to `.env.alpha` and edit:

```dotenv
COMPOSE_PROJECT_NAME=openclaw-alpha
OPENCLAW_ENV_FILE=.env.alpha
OPENCLAW_GATEWAY_TOKEN=replace-with-a-unique-random-value
TAILSCALE_AUTH_KEY=tskey-auth-replace_me
```

`TS_HOSTNAME` and all three OpenClaw data paths derive from
`COMPOSE_PROJECT_NAME`, so changing it gives the deployment a distinct DNS
name, state directory, workspace, credentials, and project-scoped Tailscale
state volume. Onboard this instance against the base Compose file:

```console
docker compose --env-file .env.alpha run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js onboard --mode local --no-install-daemon
docker compose --env-file .env.alpha run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js config set gateway.mode local
```

Then start it with the override:

```console
docker compose --env-file .env.alpha -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Repeat with `.env.beta` and another project name. Both deployments can use the
same internal ports because neither publishes them to the host. Normal
`docker compose down` preserves the Tailscale identity; `down -v` deletes its
state volume and the next start registers a new tailnet node.

## GitHub

Check the PAT and clone a repository:

```bash
docker compose run --rm --entrypoint gh openclaw-cli auth status
docker compose run --rm --workdir /home/node/.openclaw/workspace --entrypoint gh openclaw-cli repo clone OWNER/REPOSITORY
```

The system Git credential helper delegates GitHub HTTPS authentication to
`gh`, so later `git fetch`, `pull`, and `push` commands use the same runtime
token.

## MCP servers

OpenClaw now has native outbound MCP support, so no separate MCP registry is
installed. Add stdio or HTTP servers with `openclaw mcp`, for example:

```console
docker compose run --rm openclaw-cli mcp add memory --command npx --arg -y --arg @modelcontextprotocol/server-memory
docker compose run --rm openclaw-cli mcp doctor memory --probe
docker compose run --rm openclaw-cli mcp status --verbose
```

For an OAuth-enabled HTTP server, add it with `--auth oauth` and then run
`docker compose run --rm openclaw-cli mcp login SERVER_NAME`. MCP definitions
and OAuth credentials persist under the mounted OpenClaw state directory.

If sandboxing is enabled later, allow `bundle-mcp` in
`tools.sandbox.tools.alsoAllow` so configured MCP tools remain visible to
sandboxed agents.

## Update

When OpenClaw publishes a stable update, change the `FROM` tag in `Dockerfile`,
then rebuild:

```bash
docker compose build --pull --no-cache
docker compose up -d --force-recreate openclaw-gateway
```

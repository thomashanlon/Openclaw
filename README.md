# OpenClaw development image

This image stays close to the official OpenClaw container and adds a compact
development toolchain:

- the Node.js, npm, Git, curl, and native MCP support already in OpenClaw
- Python 3 with pip, venv support, headers, and common build tools
- .NET 10 SDK
- GitHub CLI (`gh`) with runtime `GH_TOKEN` support for both `gh` and HTTPS Git
- `jq`, OpenSSH client, ripgrep, zip, and unzip

The base image is pinned to the OpenClaw release that adds GPT-Live Realtime
Talk support and its immutable manifest,
`ghcr.io/openclaw/openclaw:2026.7.2-beta.7@sha256:d41807ff1e5c925ff75e71ed2b755cdea59da1431d1f4fde5051a16a3337e9ce`.
The explicit prerelease avoids the older `latest` build, which does not route
`gpt-live-1-codex` through `/v1/live`. The custom image uses the same exact
version tag in `.env.example`, so the Gateway and its bundled Control UI are
upgraded together.

## Configure

For a fresh checkout, copy the environment and OpenClaw templates:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force .openclaw-data/t5h5/config
Copy-Item openclaw.example.json .openclaw-data/t5h5/config/openclaw.json
```

On Linux or macOS:

```bash
cp .env.example .env
mkdir -p .openclaw-data/t5h5/config
cp openclaw.example.json \
  .openclaw-data/t5h5/config/openclaw.json
```

Replace these `.env` placeholders:

- `OPENCLAW_INSTANCE_NAME`: the stable Portainer host-path and Tailscale
  identity name; keep it aligned with the local Compose project name.
- `OPENCLAW_GATEWAY_TOKEN`: a long random value.
- `OPENCLAW_PUBLIC_URL`: the deployment's tailnet-only `wss://` URL used in
  mobile setup codes.
- `GH_TOKEN`: a fine-grained GitHub PAT scoped to the required repositories.
- `HEADQUARTERS_MCP_URL`: the shared Streamable HTTP MCP endpoint.
- `HEADQUARTERS_T5H5_TOKEN`, `HEADQUARTERS_FRINK_TOKEN`, and
  `HEADQUARTERS_HIGHWRIGHT_TOKEN`: distinct bearer tokens for the three
  Headquarters identities.
- `TELEGRAM_T5H5_BOT_TOKEN`, `TELEGRAM_FRINK_BOT_TOKEN`, and
  `TELEGRAM_HIGHWRIGHT_BOT_TOKEN`: separate BotFather tokens for the three
  agent-owned bots.
- `TELEGRAM_OWNER_USER_ID`: your numeric Telegram user ID. The bots use it as
  their only allowed DM sender and command owner.
- `TAILSCALE_AUTH_KEY`: a reusable, non-ephemeral Tailscale auth key.
- `OPENAI_API_KEY`: optional for agent chat, but required for OpenAI speech
  synthesis and GPT-Live Realtime Talk. Leave it blank for subscription-only
  agent chat.

The tokens are injected only at runtime and are never baked into either image.

Create the three directories from `.env`. On Linux, make them writable by the
container's non-root user:

```bash
mkdir -p .openclaw-data/t5h5/config \
  .openclaw-data/t5h5/workspace \
  .openclaw-data/t5h5/auth-profile-secrets
sudo chown -R 1000:1000 .openclaw-data
```

Docker Desktop file sharing handles these relative paths on Windows and macOS.

## Pull and authenticate

Pull the exact custom OpenClaw and Tailscale images:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml pull
```

The config has three visible agents: `T5H5`, `Frink`, and `Highwright`.
Internally, T5H5 uses OpenClaw's reserved `main` id so the other agents can
read through to the same OpenAI OAuth profile without copying a rotating
refresh token.

Authenticate the OpenAI subscription once against T5H5:

```console
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models auth --agent main login --provider openai --device-code
```

Open the displayed URL, enter the device code, and authorize the ChatGPT/Codex
subscription. No `OPENAI_API_KEY` is required for agent chat. Confirm that
Frink and Highwright resolve the inherited profile:

```console
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models status --agent main --probe
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models status --agent frink --probe
docker compose run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models status --agent highwright --probe
```

The tracked template selects `openai/gpt-5.6-sol`, uses the coding tool profile,
defaults thinking to `high`, and keeps the Gateway on loopback with token
auth. To build locally instead of pulling the registry image, temporarily set
`OPENCLAW_IMAGE=openclaw-dev:local` and run `docker compose build --pull`.

## Tailscale sidecar

The optional override gives each deployment its own Tailscale node, MagicDNS
name, HTTPS endpoint, and persistent identity. OpenClaw shares the sidecar's
network namespace but remains bound to loopback. Tailscale Serve proxies it at
`https://<TS_HOSTNAME>.<tailnet-name>.ts.net/`; no OpenClaw ports are published
on the Docker host. Set `OPENCLAW_PUBLIC_URL` to the matching `wss://` URL so
the Control UI can generate short-lived Android/iOS setup codes even though
the Gateway itself remains bound to loopback.

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
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec tailscale tailscale serve status --json
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
OPENCLAW_INSTANCE_NAME=openclaw-alpha
OPENCLAW_ENV_FILE=.env.alpha
OPENCLAW_GATEWAY_TOKEN=replace-with-a-unique-random-value
TAILSCALE_AUTH_KEY=tskey-auth-replace_me
```

`TS_HOSTNAME` and all three OpenClaw data paths derive from
`COMPOSE_PROJECT_NAME`, so changing it gives the deployment a distinct DNS
name, state directory, workspace, credentials, and project-scoped Tailscale
state volume. Authenticate this instance against the base Compose file:

```console
docker compose --env-file .env.alpha run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models auth --agent main login --provider openai --device-code
```

Then start it with the override:

```console
docker compose --env-file .env.alpha -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Repeat with `.env.beta` and another project name. Both deployments can use the
same internal ports because neither publishes them to the host. Normal
`docker compose down` preserves the Tailscale identity; `down -v` deletes its
state volume and the next start registers a new tailnet node.

Portainer reserves `COMPOSE_PROJECT_NAME` for its stack name. The
`portainer-stack.yml` file therefore uses `OPENCLAW_INSTANCE_NAME` for the
persistent host path and Tailscale hostname. Give every Portainer deployment a
different value.

## GitHub

After the stack is running, check the PAT from the same container environment
agents use:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml \
  exec openclaw-gateway gh auth status
```

The system Git credential helper delegates GitHub HTTPS authentication to
`gh`, so later `git fetch`, `pull`, and `push` commands use the same runtime
token. Ask any agent to clone the intended repository in chat for the final
end-to-end repository proof.

## Telegram

Create one bot per agent with BotFather and place the three tokens plus your
numeric Telegram user ID in `.env`. The config binds:

- Telegram account `t5h5` to agent `main` (`T5H5`)
- Telegram account `frink` to agent `frink`
- Telegram account `highwright` to agent `highwright`

Every account uses `dmPolicy: "allowlist"` with the same single numeric owner
ID. Group access is disabled, and `commands.ownerAllowFrom` grants owner-only
commands only to that Telegram identity. Verify the routing and live bot
credentials after startup:

```console
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js agents list --bindings
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js channels status --probe
```

## Voice

OpenAI GPT-Live Realtime Talk uses `gpt-live-1-codex`, the `cedar` voice,
Gateway relay transport, and an OpenAI Platform API key. The ChatGPT OAuth
subscription profile remains available for agent chat, but not GPT-Live.

OpenAI TTS remains selected separately with `gpt-4o-mini-tts` and the `fable`
voice, but it is dormant while `OPENAI_API_KEY` is blank. If a Platform key is
added later, use `/tts audio`, enable `/tts on`, or request an audio reply.

Android currently keeps GPT-Live models on native Talk until OpenClaw enables
its Android realtime path. Native Talk uses `talk.speak`, so without a Platform
TTS key Android uses its local system TTS fallback when that RPC cannot
synthesize audio. Browser and Gateway-relay GPT-Live require the Platform key
and use `cedar`.

## Workboard and agent coordination

Workboard is explicitly enabled in `openclaw.json`. Its SQLite database lives
under the mounted OpenClaw state directory, so cards survive container
restarts and move with the rest of the copied config state. Confirm the runtime
before using the Workboard tab:

```console
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js plugins inspect workboard --runtime --json
```

Cross-agent session visibility and messaging are enabled only for `main`,
`frink`, and `highwright`. This lets those three agents contact one another
without opening the capability to future agents by default.

## MCP servers

`openclaw.example.json` registers the Headquarters endpoint three times:

- `headquarters-t5h5` expands `HEADQUARTERS_T5H5_TOKEN` and is projected only
  into T5H5 (`main`).
- `headquarters-frink` expands `HEADQUARTERS_FRINK_TOKEN` and is projected only
  into `frink`.
- `headquarters-highwright` expands `HEADQUARTERS_HIGHWRIGHT_TOKEN` and is
  projected only into `highwright`.

Each agent denies the other two servers' `server__*` tool prefixes. Do not add
`auth: "oauth"` to these entries: OpenClaw ignores static Authorization headers
when native MCP OAuth mode is enabled.

Probe both saved identities:

```console
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js mcp doctor headquarters-t5h5 --probe
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js mcp doctor headquarters-frink --probe
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec openclaw-gateway node dist/index.js mcp doctor headquarters-highwright --probe
```

If sandboxing is enabled later, allow `bundle-mcp` in
`tools.sandbox.tools.alsoAllow` so configured MCP tools remain visible to
sandboxed agents.

This is tool-policy and runtime-projection isolation inside one trusted Gateway.
It is not a hostile-process secret boundary: both bearer values and `GH_TOKEN`
exist in the Gateway process environment. Use separate Gateway stacks if the
agents must be unable to inspect each other's process-level credentials.

## Move to the homeserver

For identical behavior, use the same repository revision and copy:

- `.env`
- the whole `.openclaw-data/t5h5/` directory, not only
  `openclaw.json`; this includes OpenAI OAuth state, the auth-profile encryption
  key, agent databases, and workspaces

The Compose files and `tailscale/serve.json` come from this repository. On the
Linux homeserver:

```bash
sudo chown -R 1000:1000 .openclaw-data
sudo chmod 700 .openclaw-data/t5h5/config \
  .openclaw-data/t5h5/auth-profile-secrets
sudo chmod 600 .env .openclaw-data/t5h5/config/openclaw.json
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml pull
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

### Portainer deployment

`portainer-stack.yml` is the Portainer-managed equivalent. It publishes no
host ports and persists all mutable state under
`/opt/openclaw/${OPENCLAW_INSTANCE_NAME}`:

- `config`, `workspace`, `shared-docs`, and `auth-profile-secrets` for OpenClaw
- `tailscale-state` for the node identity
- `tailscale/serve.json` for the tailnet-only HTTPS proxy

Set `OPENCLAW_INSTANCE_NAME=t5h5` in `.env`, then copy the migrated directories
to `/opt/openclaw/t5h5`. Stop any older Compose project that uses the same
workspace or Telegram bot tokens so only one Gateway can poll each bot. In
Portainer:

1. Open **Stacks**, add a stack such as `openclaw-t5h5`, and paste
   `portainer-stack.yml` into the web editor.
2. Open the environment-variable **Advanced mode** and paste the populated
   `.env`.
3. Deploy the stack and wait for both `tailscale` and `openclaw-gateway` to
   become healthy.

For an existing stack, first wait for the repository's **Build and Publish
Docker Image** workflow to publish
`ghcr.io/thomashanlon/openclaw:2026.7.2-beta.7`. Then replace the stack's
`OPENCLAW_IMAGE` environment value with that exact tag and use **Update the
stack** with **Re-pull image** enabled. This recreates the Gateway from the new
image; the same image serves the bundled Control UI. No persistent OpenClaw or
Tailscale volumes need to be removed.

The one-shot `openclaw-config-migrate` service runs before the Gateway. For an
older config it creates `openclaw.json.pre-2026.7.2-beta.6`, migrates the config
keys removed by this beta, and also migrates OpenClaw's
`openclaw.json.bak` last-known-good file so startup cannot restore the legacy
schema. Each changed file gets its own `.pre-2026.7.2-beta.6` backup. It then
runs the beta's non-interactive safe `doctor --fix` migrations, including the
shared state SQLite repairs. The service mounts the same workspace as the
Gateway so Doctor can also import retired workspace setup state. Doctor
receives the same config-reference environment as the Gateway, but remains
network-isolated with all capabilities dropped. If doctor reports a post-repair
validation error, a fresh
`config validate` process must succeed before the migration is accepted;
invalid config still blocks Gateway startup. On later redeploys the repairs are
idempotent and leave current data untouched. In Portainer, an exited migration
container with exit code `0` is expected.

The custom image is large. If stack creation times out while pulling it, use
Portainer's **Images** page to pull
`ghcr.io/thomashanlon/openclaw:2026.7.2-beta.7` first, then deploy the stack
again. The exact versioned value in `.env` remains the source of truth; do not
substitute `latest`.

Verify that the OpenClaw containers have no published ports and that the
gateway responds only at its Tailscale HTTPS name. Portainer's stack name may
change; `OPENCLAW_INSTANCE_NAME` must continue to match the copied directory
and intended Tailscale hostname.

The pinned image version ensures the homeserver runs the custom build based on
OpenClaw `2026.7.2-beta.7`. The current custom image is `linux/amd64`; publish
an arm64 manifest before using an ARM homeserver.

Docker Desktop presents these Windows bind mounts to the container as mode
`0777` and needs inherited NTFS access for file sharing, so the local OpenClaw
security audit reports that limitation. The `chmod` commands above set real
owner-only permissions after the state is copied to Linux.

With Docker Compose, the Tailscale node identity lives in the project-scoped
`tailscale-state` Docker volume and is not inside `.openclaw-data`. Portainer
instead bind-mounts it at
`/opt/openclaw/${OPENCLAW_INSTANCE_NAME}/tailscale-state`. Copying that state
preserves the exact existing tailnet node identity; otherwise the reusable auth
key enrolls a new node. Stop the local deployment first if retaining the same
hostname. If the auth key has expired by migration time, replace only
`TAILSCALE_AUTH_KEY` with a fresh reusable key.

If `COMPOSE_PROJECT_NAME` changes on the homeserver, rename the copied
`.openclaw-data/t5h5` directory to match it, or set the three
`OPENCLAW_*_DIR` values explicitly to the copied path.

## Update

When OpenClaw publishes an update, change both the `FROM` tag and digest in
`Dockerfile`, validate the custom image locally, and publish the matching
versioned `OPENCLAW_IMAGE` before redeploying:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml pull
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --force-recreate
```

Do not use the dashboard's self-update button for this immutable container
deployment; rebuild and recreate the image so local and homeserver state stay
reproducible.

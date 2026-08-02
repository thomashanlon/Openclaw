import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const composeEnvironment = {
  ...process.env,
  GH_TOKEN: "test",
  HEADQUARTERS_FRINK_TOKEN: "test",
  HEADQUARTERS_HIGHWRIGHT_TOKEN: "test",
  HEADQUARTERS_MCP_URL: "https://example.invalid/mcp",
  HEADQUARTERS_T5H5_TOKEN: "test",
  OPENCLAW_AUTH_PROFILE_SECRET_DIR: "./.test-state/auth-profile-secrets",
  OPENCLAW_CONFIG_DIR: "./.test-state/config",
  OPENCLAW_GATEWAY_TOKEN: "test",
  OPENCLAW_IMAGE: "example.invalid/openclaw:test",
  OPENCLAW_INSTANCE_NAME: "test",
  OPENCLAW_PUBLIC_URL: "wss://example.invalid/",
  OPENCLAW_WORKSPACE_DIR: "./.test-state/workspace",
  TAILSCALE_AUTH_KEY: "test",
  TAILSCALE_IMAGE: "example.invalid/tailscale:test",
  TELEGRAM_FRINK_BOT_TOKEN: "test",
  TELEGRAM_HIGHWRIGHT_BOT_TOKEN: "test",
  TELEGRAM_OWNER_USER_ID: "1",
  TELEGRAM_T5H5_BOT_TOKEN: "test",
};

function renderCompose(file) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", file, "config", "--format", "json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: composeEnvironment,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const file of ["docker-compose.yml", "portainer-stack.yml"]) {
  test(`${file} exposes the Gateway workspace to the migration service`, () => {
    const services = renderCompose(file).services;
    const gatewayMount = services["openclaw-gateway"].volumes.find(
      (volume) => volume.target === "/home/node/.openclaw/workspace",
    );
    const migrationMount = services["openclaw-config-migrate"].volumes.find(
      (volume) => volume.target === "/home/node/.openclaw/workspace",
    );

    assert.ok(gatewayMount, "Gateway workspace mount is missing");
    assert.ok(migrationMount, "migration service workspace mount is missing");
    assert.equal(migrationMount.source, gatewayMount.source);
  });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { migrateConfig } from "./migrate-openclaw-config.mjs";

const scriptPath = fileURLToPath(
  new URL("./migrate-openclaw-config.mjs", import.meta.url),
);

test("migrates the beta.6 config keys and pins the GPT-Live voice", () => {
  const config = {
    agents: {
      list: [
        { id: "main", default: true, model: "openai/gpt-5.6-sol" },
        { id: "frink", model: "openai/gpt-5.6-sol" },
      ],
      defaults: {
        models: {
          "openai/gpt-5.6-sol": {},
        },
      },
    },
    messages: {
      responsePrefix: "[OpenClaw]",
      tts: {
        provider: "openai",
        providers: {
          openai: {
            model: "gpt-4o-mini-tts",
            speakerVoice: "fable",
          },
        },
      },
    },
    talk: {
      realtime: {
        model: "gpt-live-1-codex",
      },
    },
    meta: {
      lastTouchedVersion: "2026.7.1",
      lastTouchedAt: "2026-08-01T00:00:00.000Z",
    },
  };

  const changes = migrateConfig(config);

  assert.deepEqual(changes, [
    "Moved agents.list to agents.entries.",
    "Copied agents.defaults.models to agents.defaults.modelPolicy.allow.",
    "Moved messages.tts to top-level tts.",
    "Pinned GPT-Live Talk voice to cedar.",
    "Removed retired meta.lastTouchedAt.",
  ]);
  assert.deepEqual(config.agents.entries, {
    main: { default: true, model: "openai/gpt-5.6-sol" },
    frink: { model: "openai/gpt-5.6-sol" },
  });
  assert.equal("list" in config.agents, false);
  assert.deepEqual(config.agents.defaults.modelPolicy.allow, [
    "openai/gpt-5.6-sol",
  ]);
  assert.deepEqual(config.messages, { responsePrefix: "[OpenClaw]" });
  assert.deepEqual(config.tts, {
    provider: "openai",
    providers: {
      openai: {
        model: "gpt-4o-mini-tts",
        speakerVoice: "fable",
      },
    },
  });
  assert.equal(config.talk.realtime.model, "gpt-live-1-codex");
  assert.equal(config.talk.realtime.speakerVoice, "cedar");
  assert.equal(
    config.talk.realtime.providers.openai.speakerVoice,
    "cedar",
  );
  assert.deepEqual(config.meta, { lastTouchedVersion: "2026.7.1" });
});

test("is idempotent after migration", () => {
  const config = {
    agents: {
      entries: {
        main: { default: true },
      },
      defaults: {
        models: { "openai/gpt-5.6-sol": {} },
        modelPolicy: { allow: ["openai/gpt-5.6-sol"] },
      },
    },
    tts: { provider: "openai" },
  };

  assert.deepEqual(migrateConfig(config), []);
});

test("pins GPT-Live Talk to cedar for provider and session launch", () => {
  const config = {
    talk: {
      realtime: {
        provider: "openai",
        model: "gpt-live-1-codex",
        speakerVoice: "fable",
        providers: {
          openai: {
            speakerVoice: "fable",
          },
        },
      },
    },
  };

  assert.deepEqual(migrateConfig(config), [
    "Pinned GPT-Live Talk voice to cedar.",
  ]);
  assert.equal(config.talk.realtime.speakerVoice, "cedar");
  assert.equal(
    config.talk.realtime.providers.openai.speakerVoice,
    "cedar",
  );
  assert.deepEqual(migrateConfig(config), []);
});

test("migrates legacy memory search before converting the agent roster", () => {
  const config = {
    memory: {
      search: {
        query: { maxResults: 11 },
      },
    },
    agents: {
      defaults: {
        memorySearch: {
          provider: "auto",
          chunkSize: 600,
          maxResults: 7,
          store: { path: "/legacy/default-memory.sqlite" },
        },
      },
      list: [
        {
          id: "main",
          default: true,
          memorySearch: {
            provider: "auto",
            maxResults: 5,
          },
        },
      ],
    },
  };

  const changes = migrateConfig(config);

  assert.match(changes.join("\n"), /memorySearch defaults.*memory\.search/);
  assert.equal("memorySearch" in config.agents.defaults, false);
  assert.deepEqual(config.memory.search, {
    query: { maxResults: 11 },
    provider: "openai",
    chunking: { tokens: 600 },
    store: {},
  });
  assert.deepEqual(config.agents.entries.main.memory.search, {
    provider: "openai",
    query: { maxResults: 5 },
  });
  assert.equal("memorySearch" in config.agents.entries.main, false);
});

test("refuses a mixed agent roster instead of dropping data", () => {
  const config = {
    agents: {
      list: [{ id: "main", default: true }],
      entries: { main: { default: true } },
    },
  };

  assert.throws(
    () => migrateConfig(config),
    /both agents\.list and agents\.entries/,
  );
});

test("backs up and atomically migrates a config file only once", async (t) => {
  const testDirectory = await mkdtemp(
    join(tmpdir(), "openclaw-config-migrate-"),
  );
  t.after(() => rm(testDirectory, { force: true, recursive: true }));

  const configPath = join(testDirectory, "openclaw.json");
  const original = `${JSON.stringify(
    {
      agents: {
        list: [{ id: "main", default: true }],
        defaults: { models: { "openai/gpt-5.6-sol": {} } },
      },
      messages: { tts: { provider: "openai" } },
    },
    null,
    2,
  )}\n`;
  await writeFile(configPath, original, "utf8");
  const lastKnownGoodPath = `${configPath}.bak`;
  const lastKnownGood = `${JSON.stringify(
    {
      agents: {
        defaults: {
          memorySearch: {
            provider: "auto",
            maxResults: 6,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
  await writeFile(lastKnownGoodPath, lastKnownGood, "utf8");

  const env = {
    OPENCLAW_CONFIG_PATH: configPath,
  };
  if (process.env.SystemRoot) {
    env.SystemRoot = process.env.SystemRoot;
  }
  const firstRun = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
  });
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.match(
    firstRun.stdout,
    /OpenClaw config is ready for 2026\.7\.2-beta\.6/,
  );
  assert.equal(
    await readFile(`${configPath}.pre-2026.7.2-beta.6`, "utf8"),
    original,
  );
  assert.equal(
    await readFile(`${lastKnownGoodPath}.pre-2026.7.2-beta.6`, "utf8"),
    lastKnownGood,
  );
  assert.deepEqual(JSON.parse(await readFile(lastKnownGoodPath, "utf8")), {
    agents: { defaults: {} },
    memory: {
      search: {
        provider: "openai",
        query: { maxResults: 6 },
      },
    },
  });

  const migrated = await readFile(configPath, "utf8");
  const secondRun = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
  });
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.match(secondRun.stdout, /already compatible with 2026\.7\.2-beta\.6/);
  assert.equal(await readFile(configPath, "utf8"), migrated);
});

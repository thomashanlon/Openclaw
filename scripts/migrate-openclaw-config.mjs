import {
  constants,
  copyFile,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TARGET_VERSION = "2026.7.2-beta.6";
const DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeMissing(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = value;
    } else if (isRecord(target[key]) && isRecord(value)) {
      mergeMissing(target[key], value);
    }
  }
}

function migrateAgentRoster(config, changes) {
  const agents = config.agents;
  if (!isRecord(agents) || !Object.hasOwn(agents, "list")) {
    return;
  }
  if (Object.hasOwn(agents, "entries")) {
    throw new Error(
      "Config contains both agents.list and agents.entries; refusing to choose between them.",
    );
  }
  if (!Array.isArray(agents.list)) {
    throw new Error("agents.list must be an array before it can be migrated.");
  }

  const entries = {};
  for (const value of agents.list) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      value.id.trim() !== value.id ||
      !value.id
    ) {
      throw new Error(
        "Every agents.list entry must have a non-empty, trimmed string id.",
      );
    }
    if (Object.hasOwn(entries, value.id)) {
      throw new Error(`Duplicate agent id in agents.list: ${value.id}`);
    }
    const { id, ...entry } = value;
    entries[id] = entry;
  }

  if (Object.keys(entries).length === 0) {
    entries.main = { default: true };
  } else if (!Object.values(entries).some((entry) => entry.default === true)) {
    entries[Object.keys(entries)[0]].default = true;
  }

  delete agents.list;
  agents.entries = entries;
  changes.push("Moved agents.list to agents.entries.");
}

function preserveModelPolicy(config, changes) {
  const defaults = config.agents?.defaults;
  if (!isRecord(defaults) || !isRecord(defaults.models)) {
    return;
  }
  const models = Object.keys(defaults.models);
  if (models.length === 0) {
    return;
  }
  if (defaults.modelPolicy !== undefined && !isRecord(defaults.modelPolicy)) {
    throw new Error("agents.defaults.modelPolicy must be an object.");
  }
  const modelPolicy = defaults.modelPolicy ?? {};
  if (!Object.hasOwn(modelPolicy, "allow")) {
    modelPolicy.allow = models;
    defaults.modelPolicy = modelPolicy;
    changes.push(
      "Copied agents.defaults.models to agents.defaults.modelPolicy.allow.",
    );
  }
}

function migrateTts(config, changes) {
  const messages = config.messages;
  if (!isRecord(messages) || !Object.hasOwn(messages, "tts")) {
    return;
  }
  if (!isRecord(messages.tts)) {
    throw new Error("messages.tts must be an object before it can be migrated.");
  }

  const legacyTts = messages.tts;
  if (isRecord(legacyTts.realtime)) {
    const legacyVoice =
      legacyTts.realtime.speakerVoice ?? legacyTts.realtime.voice;
    if (legacyVoice !== undefined) {
      if (config.talk !== undefined && !isRecord(config.talk)) {
        throw new Error(
          "talk must be an object before realtime voice can be migrated.",
        );
      }
      const talk = config.talk ?? {};
      if (talk.realtime !== undefined && !isRecord(talk.realtime)) {
        throw new Error(
          "talk.realtime must be an object before realtime voice can be migrated.",
        );
      }
      const realtime = talk.realtime ?? {};
      if (!Object.hasOwn(realtime, "speakerVoice")) {
        realtime.speakerVoice = legacyVoice;
        talk.realtime = realtime;
        config.talk = talk;
      }
    }
    delete legacyTts.realtime;
  }

  if (config.tts !== undefined && !isRecord(config.tts)) {
    throw new Error("tts must be an object before messages.tts can be migrated.");
  }
  const tts = config.tts ?? {};
  mergeMissing(tts, legacyTts);
  config.tts = tts;
  delete messages.tts;
  if (Object.keys(messages).length === 0) {
    delete config.messages;
  }
  changes.push("Moved messages.tts to top-level tts.");
}

function removeRetiredMetadata(config, changes) {
  if (!isRecord(config.meta) || !Object.hasOwn(config.meta, "lastTouchedAt")) {
    return;
  }
  delete config.meta.lastTouchedAt;
  if (Object.keys(config.meta).length === 0) {
    delete config.meta;
  }
  changes.push("Removed retired meta.lastTouchedAt.");
}

export function migrateConfig(config) {
  if (!isRecord(config)) {
    throw new Error("OpenClaw config must be a JSON object.");
  }

  const changes = [];
  migrateAgentRoster(config, changes);
  preserveModelPolicy(config, changes);
  migrateTts(config, changes);
  removeRetiredMetadata(config, changes);
  return changes;
}

async function main() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  let source;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log(
        `No OpenClaw config found at ${configPath}; migration skipped.`,
      );
      return;
    }
    throw error;
  }

  let config;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Could not parse OpenClaw config at ${configPath}: ${error.message}`,
    );
  }

  const changes = migrateConfig(config);
  if (changes.length === 0) {
    console.log(`OpenClaw config is already compatible with ${TARGET_VERSION}.`);
    return;
  }

  const backupPath = `${configPath}.pre-${TARGET_VERSION}`;
  try {
    await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
    console.log(`Backed up OpenClaw config to ${backupPath}.`);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    console.log(`Preserving existing OpenClaw config backup at ${backupPath}.`);
  }

  const fileMode = (await stat(configPath)).mode & 0o777;
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: fileMode,
    });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  for (const change of changes) {
    console.log(change);
  }
  console.log(`OpenClaw config is ready for ${TARGET_VERSION}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`OpenClaw config migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

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
const GPT_LIVE_TALK_MODEL = "gpt-live-1-codex";
const GPT_LIVE_TALK_VOICE = "cedar";

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

const MEMORY_SEARCH_FIELD_MAPPINGS = [
  { legacyKey: "chunkSize", parentKey: "chunking", canonicalKey: "tokens" },
  {
    legacyKey: "chunkOverlap",
    parentKey: "chunking",
    canonicalKey: "overlap",
  },
  { legacyKey: "maxResults", parentKey: "query", canonicalKey: "maxResults" },
];

function getOrCreateRecord(container, key, path) {
  if (container[key] === undefined) {
    container[key] = {};
  }
  if (!isRecord(container[key])) {
    throw new Error(`${path} must be an object before it can be migrated.`);
  }
  return container[key];
}

function migrateMemorySearchFields(memorySearch, path, changes) {
  for (const { legacyKey, parentKey, canonicalKey } of
    MEMORY_SEARCH_FIELD_MAPPINGS) {
    if (!Object.hasOwn(memorySearch, legacyKey)) {
      continue;
    }
    const legacyValue = memorySearch[legacyKey];
    const canonicalParent = getOrCreateRecord(
      memorySearch,
      parentKey,
      `${path}.${parentKey}`,
    );
    if (!Object.hasOwn(canonicalParent, canonicalKey)) {
      canonicalParent[canonicalKey] = legacyValue;
      changes.push(
        `Moved ${path}.${legacyKey} to ${path}.${parentKey}.${canonicalKey}.`,
      );
    }
    delete memorySearch[legacyKey];
  }

  if (
    typeof memorySearch.provider === "string" &&
    memorySearch.provider.trim().toLowerCase() === "auto"
  ) {
    memorySearch.provider = "openai";
    changes.push(`Changed ${path}.provider from auto to openai.`);
  }

  if (isRecord(memorySearch.store) && typeof memorySearch.store.path === "string") {
    delete memorySearch.store.path;
    changes.push(`Removed ${path}.store.path; indexes now use the agent database.`);
  }
}

function migrateMemorySearch(config, changes) {
  const agents = isRecord(config.agents) ? config.agents : null;
  const defaults = isRecord(agents?.defaults) ? agents.defaults : null;
  const legacyDefaults = defaults?.memorySearch;
  const legacyTopLevel = config.memorySearch;

  if (legacyDefaults !== undefined && !isRecord(legacyDefaults)) {
    throw new Error(
      "agents.defaults.memorySearch must be an object before it can be migrated.",
    );
  }
  if (legacyTopLevel !== undefined && !isRecord(legacyTopLevel)) {
    throw new Error("memorySearch must be an object before it can be migrated.");
  }

  if (isRecord(legacyDefaults) || isRecord(legacyTopLevel)) {
    const memory = getOrCreateRecord(config, "memory", "memory");
    const target =
      memory.search === undefined
        ? {}
        : structuredClone(
            getOrCreateRecord(memory, "search", "memory.search"),
          );
    if (isRecord(legacyDefaults)) {
      mergeMissing(target, legacyDefaults);
      delete defaults.memorySearch;
    }
    if (isRecord(legacyTopLevel)) {
      mergeMissing(target, legacyTopLevel);
      delete config.memorySearch;
    }
    memory.search = target;
    changes.push("Moved legacy memorySearch defaults to memory.search.");
  }

  if (Array.isArray(agents?.list)) {
    for (const [index, value] of agents.list.entries()) {
      if (!isRecord(value) || value.memorySearch === undefined) {
        continue;
      }
      if (!isRecord(value.memorySearch)) {
        throw new Error(
          `agents.list.${index}.memorySearch must be an object before it can be migrated.`,
        );
      }
      const memory = getOrCreateRecord(
        value,
        "memory",
        `agents.list.${index}.memory`,
      );
      const target =
        memory.search === undefined
          ? {}
          : structuredClone(
              getOrCreateRecord(
                memory,
                "search",
                `agents.list.${index}.memory.search`,
              ),
            );
      mergeMissing(target, value.memorySearch);
      memory.search = target;
      delete value.memorySearch;
      changes.push(
        `Moved agents.list.${index}.memorySearch to agents.list.${index}.memory.search.`,
      );
    }
  }

  const canonical = isRecord(config.memory)
    ? config.memory.search
    : undefined;
  if (canonical !== undefined) {
    if (!isRecord(canonical)) {
      throw new Error("memory.search must be an object before it can be migrated.");
    }
    migrateMemorySearchFields(canonical, "memory.search", changes);
  }
  if (Array.isArray(agents?.list)) {
    for (const [index, value] of agents.list.entries()) {
      const agentSearch = isRecord(value?.memory) ? value.memory.search : undefined;
      if (agentSearch === undefined) {
        continue;
      }
      if (!isRecord(agentSearch)) {
        throw new Error(
          `agents.list.${index}.memory.search must be an object before it can be migrated.`,
        );
      }
      migrateMemorySearchFields(
        agentSearch,
        `agents.list.${index}.memory.search`,
        changes,
      );
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

function pinGptLiveTalkVoice(config, changes) {
  const talk = config.talk;
  const realtime = isRecord(talk) ? talk.realtime : undefined;
  if (!isRecord(realtime) || realtime.model !== GPT_LIVE_TALK_MODEL) {
    return;
  }

  const providers = getOrCreateRecord(
    realtime,
    "providers",
    "talk.realtime.providers",
  );
  const openai = getOrCreateRecord(
    providers,
    "openai",
    "talk.realtime.providers.openai",
  );
  if (
    realtime.speakerVoice === GPT_LIVE_TALK_VOICE &&
    openai.speakerVoice === GPT_LIVE_TALK_VOICE
  ) {
    return;
  }
  realtime.speakerVoice = GPT_LIVE_TALK_VOICE;
  openai.speakerVoice = GPT_LIVE_TALK_VOICE;
  changes.push("Pinned GPT-Live Talk voice to cedar.");
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
  migrateMemorySearch(config, changes);
  migrateAgentRoster(config, changes);
  preserveModelPolicy(config, changes);
  migrateTts(config, changes);
  pinGptLiveTalkVoice(config, changes);
  removeRetiredMetadata(config, changes);
  return changes;
}

async function migrateConfigFile(configPath, label, required) {
  let source;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && !required) {
      return;
    }
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
    console.log(`${label} is already compatible with ${TARGET_VERSION}.`);
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
    console.log(label === "OpenClaw config" ? change : `${label}: ${change}`);
  }
  console.log(`${label} is ready for ${TARGET_VERSION}.`);
}

async function main() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  await migrateConfigFile(configPath, "OpenClaw config", true);
  await migrateConfigFile(
    `${configPath}.bak`,
    "OpenClaw last-known-good config",
    false,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`OpenClaw config migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

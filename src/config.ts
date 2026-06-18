import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type BigentConfig = {
  homeDir: string;
  cwd: string;
  telegramToken?: string;
  telegramAllowlist: Set<string>;
  loopMaxTurns: number;
  piApiProvider?: string;
  piApiKey?: string;
  piThinking?: BigentThinkingLevel;
};

export type BigentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export const CONFIG_DIR = path.join(os.homedir(), ".config", "bigent");
export const CONFIG_ENV_PATH = path.join(CONFIG_DIR, "bigent.env");

const THINKING_LEVEL_SET = new Set(THINKING_LEVELS);
const CONFIG_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "BIGENT_TELEGRAM_ALLOWLIST",
  "BIGENT_CWD",
  "BIGENT_HOME",
  "BIGENT_PI_API_PROVIDER",
  "BIGENT_PI_API_KEY",
  "BIGENT_PI_THINKING",
  "BIGENT_LOOP_MAX_TURNS",
] as const;

export type ConfigEnvKey = (typeof CONFIG_KEYS)[number];
export type ConfigEnv = Partial<Record<ConfigEnvKey, string>>;

export function loadConfig(): BigentConfig {
  const env = getConfigEnv();
  const homeDir = path.resolve(env.BIGENT_HOME ?? path.join(os.homedir(), ".bigent"));
  const cwd = path.resolve(env.BIGENT_CWD ?? process.cwd());
  const telegramAllowlist = new Set(
    (env.BIGENT_TELEGRAM_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  return {
    homeDir,
    cwd,
    telegramToken: emptyToUndefined(env.TELEGRAM_BOT_TOKEN),
    telegramAllowlist,
    loopMaxTurns: parseLoopMaxTurns(env.BIGENT_LOOP_MAX_TURNS),
    piApiProvider: emptyToUndefined(env.BIGENT_PI_API_PROVIDER),
    piApiKey: emptyToUndefined(env.BIGENT_PI_API_KEY),
    piThinking: parseThinkingLevel(env.BIGENT_PI_THINKING),
  };
}

export function getConfigEnv(): ConfigEnv {
  return { ...readConfigEnv(), ...processConfigEnv() };
}

export function readConfigEnv(filePath = CONFIG_ENV_PATH): ConfigEnv {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const values: ConfigEnv = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match || !isConfigKey(match[1])) continue;
    values[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return values;
}

export function writeConfigEnv(values: ConfigEnv, filePath = CONFIG_ENV_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lines = [
    "# BIgent configuration",
    "# Environment variables still override values in this file.",
    ...CONFIG_KEYS.filter((key) => values[key] !== undefined).map((key) => `${key}=${quoteEnvValue(values[key] ?? "")}`),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"), { mode: 0o600 });
}

export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseThinkingLevel(value: string | undefined): BigentThinkingLevel | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!THINKING_LEVEL_SET.has(normalized as BigentThinkingLevel)) {
    throw new Error(`Invalid BIGENT_PI_THINKING: ${normalized}`);
  }
  return normalized as BigentThinkingLevel;
}

function parseLoopMaxTurns(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return 30;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid BIGENT_LOOP_MAX_TURNS: ${normalized}`);
  }
  return parsed;
}

function processConfigEnv(): ConfigEnv {
  const values: ConfigEnv = {};
  for (const key of CONFIG_KEYS) {
    if (process.env[key] !== undefined) {
      values[key] = process.env[key];
    }
  }
  return values;
}

function isConfigKey(value: string): value is ConfigEnvKey {
  return CONFIG_KEYS.includes(value as ConfigEnvKey);
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return value;
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

import os from "node:os";
import path from "node:path";

export type BigentConfig = {
  homeDir: string;
  cwd: string;
  telegramToken?: string;
  telegramAllowlist: Set<string>;
  piProvider?: string;
  piModel?: string;
  piApiProvider?: string;
  piApiKey?: string;
  piThinking?: BigentThinkingLevel;
};

export type BigentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function loadConfig(): BigentConfig {
  const homeDir = path.resolve(process.env.BIGENT_HOME ?? path.join(os.homedir(), ".bigent"));
  const cwd = path.resolve(process.env.BIGENT_CWD ?? process.cwd());
  const telegramAllowlist = new Set(
    (process.env.BIGENT_TELEGRAM_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  return {
    homeDir,
    cwd,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramAllowlist,
    piProvider: emptyToUndefined(process.env.BIGENT_PI_PROVIDER),
    piModel: emptyToUndefined(process.env.BIGENT_PI_MODEL),
    piApiProvider: emptyToUndefined(process.env.BIGENT_PI_API_PROVIDER),
    piApiKey: emptyToUndefined(process.env.BIGENT_PI_API_KEY),
    piThinking: parseThinkingLevel(process.env.BIGENT_PI_THINKING),
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseThinkingLevel(value: string | undefined): BigentThinkingLevel | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!THINKING_LEVELS.has(normalized)) {
    throw new Error(`Invalid BIGENT_PI_THINKING: ${normalized}`);
  }
  return normalized as BigentThinkingLevel;
}

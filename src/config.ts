import os from "node:os";
import path from "node:path";

export type BigentConfig = {
  homeDir: string;
  cwd: string;
  telegramToken?: string;
  telegramAllowlist: Set<string>;
};

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
  };
}

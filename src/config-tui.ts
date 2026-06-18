import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  CONFIG_ENV_PATH,
  THINKING_LEVELS,
  getConfigEnv,
  maskSecret,
  readConfigEnv,
  writeConfigEnv,
  type ConfigEnv,
} from "./config.js";

type Field = {
  key: keyof ConfigEnv;
  label: string;
  secret?: boolean;
  validate?: (value: string) => string | undefined;
};

const FIELDS: Field[] = [
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", secret: true },
  { key: "BIGENT_TELEGRAM_ALLOWLIST", label: "Telegram allowlist IDs" },
  { key: "BIGENT_CWD", label: "Working directory" },
  { key: "BIGENT_HOME", label: "State directory" },
  { key: "BIGENT_PI_API_PROVIDER", label: "Pi API provider" },
  { key: "BIGENT_PI_API_KEY", label: "Pi API key", secret: true },
  {
    key: "BIGENT_PI_THINKING",
    label: `Pi thinking (${THINKING_LEVELS.join("|")})`,
    validate: (value) => (!value || THINKING_LEVELS.includes(value as never) ? undefined : "Invalid thinking level."),
  },
  {
    key: "BIGENT_LOOP_MAX_TURNS",
    label: "Loop max turns",
    validate: (value) => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 ? undefined : "Enter a positive integer.";
    },
  },
];

export async function runConfigTui(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const fileValues = readConfigEnv();
  const effectiveValues = getConfigEnv();
  const nextValues: ConfigEnv = { ...fileValues };

  try {
    console.log(`BIgent config TUI`);
    console.log(`File: ${CONFIG_ENV_PATH}`);
    console.log("Press Enter to keep the current file value. Environment overrides are shown when active.\n");

    for (const field of FIELDS) {
      for (;;) {
        const fileValue = nextValues[field.key] ?? "";
        const effectiveValue = effectiveValues[field.key];
        const shownFileValue = field.secret ? maskSecret(fileValue) : fileValue;
        const shownEffectiveValue =
          effectiveValue !== undefined && effectiveValue !== fileValue
            ? `, env override: ${field.secret ? maskSecret(effectiveValue) : effectiveValue}`
            : "";
        const answer = await rl.question(`${field.label} [${shownFileValue || "unset"}${shownEffectiveValue}]: `);
        const value = answer.trim() ? answer.trim() : fileValue;
        const error = field.validate?.(value);
        if (error) {
          console.log(error);
          continue;
        }
        if (value) {
          nextValues[field.key] = value;
        } else {
          delete nextValues[field.key];
        }
        break;
      }
    }

    const save = (await rl.question("\nSave changes? [Y/n]: ")).trim().toLowerCase();
    if (save && save !== "y" && save !== "yes") {
      console.log("Config unchanged.");
      return;
    }

    writeConfigEnv(nextValues);
    console.log(`Saved ${CONFIG_ENV_PATH}`);
  } finally {
    rl.close();
  }
}

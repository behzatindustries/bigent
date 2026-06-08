#!/usr/bin/env node
import { BigentAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { TelegramBridge } from "./telegram.js";
import { updatePiDependency } from "./update-pi.js";

const HELP = `BIgent - Behzat Industries Agent

Usage:
  bigent ask <prompt...>       Run one prompt through Pi
  bigent telegram              Run the Telegram bot bridge
  bigent update-pi [--commit]  One-click update to the latest Pi SDK
  bigent help                  Show this help

Environment:
  TELEGRAM_BOT_TOKEN           Telegram bot token for telegram mode
  BIGENT_TELEGRAM_ALLOWLIST    Optional comma-separated user/chat IDs
  BIGENT_CWD                   Optional working directory for Pi sessions
  BIGENT_HOME                  Optional BIgent state dir, defaults to ~/.bigent
`;

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  const config = loadConfig();

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (command === "ask") {
    const prompt = args.join(" ").trim();
    if (!prompt) {
      throw new Error("Usage: bigent ask <prompt...>");
    }
    const agent = new BigentAgent({ homeDir: config.homeDir, cwd: config.cwd });
    const answer = await agent.prompt(prompt);
    console.log(answer || "Done.");
    return;
  }

  if (command === "telegram") {
    await new TelegramBridge(config).run();
    return;
  }

  if (command === "update-pi") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: bigent update-pi [--commit]");
      return;
    }
    const unsupported = args.filter((arg) => arg !== "--commit");
    if (unsupported.length > 0) {
      throw new Error(`Unsupported update-pi option: ${unsupported.join(", ")}`);
    }
    updatePiDependency({ commit: args.includes("--commit") });
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

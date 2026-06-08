#!/usr/bin/env node
import { BigentAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { TelegramBridge } from "./telegram.js";
import { updateAgentAndPi, updatePiDependency } from "./update-pi.js";
import { webSearch } from "./tools.js";

const HELP = `BIgent - Behzat Industries Agent

Usage:
  bigent ask <prompt...>       Run one prompt through Pi
  bigent search <query...>     Test BIgent web search directly
  bigent telegram              Run the Telegram bot bridge
  bigent update                Update BIgent source and Pi SDK
  bigent update-pi [--commit]  One-click update to the latest Pi SDK
  bigent help                  Show this help

Environment:
  TELEGRAM_BOT_TOKEN           Telegram bot token for telegram mode
  BIGENT_TELEGRAM_ALLOWLIST    Optional comma-separated user/chat IDs
  BIGENT_CWD                   Optional working directory for Pi sessions
  BIGENT_HOME                  Optional BIgent state dir, defaults to ~/.bigent
  BIGENT_PI_PROVIDER           Optional Pi provider, for example anthropic
  BIGENT_PI_MODEL              Optional Pi model, for example claude-sonnet-4-5
  BIGENT_PI_API_KEY            Optional runtime API key for the selected provider
  BIGENT_PI_THINKING           Optional: off, minimal, low, medium, high, xhigh

Tools:
  web_search, http_fetch, now, subagent, plus Pi read/bash/edit/write/grep/find/ls
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
    const agent = new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      piProvider: config.piProvider,
      piModel: config.piModel,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });
    const answer = await agent.prompt(prompt);
    console.log(answer || "Done.");
    return;
  }

  if (command === "search") {
    const query = args.join(" ").trim();
    if (!query) {
      throw new Error("Usage: bigent search <query...>");
    }
    const results = await webSearch(query, 5);
    console.log(results.length ? results.join("\n\n") : "No results found.");
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

  if (command === "update") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: bigent update");
      return;
    }
    if (args.length > 0) {
      throw new Error(`Unsupported update option: ${args.join(", ")}`);
    }
    updateAgentAndPi();
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

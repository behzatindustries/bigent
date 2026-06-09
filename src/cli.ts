#!/usr/bin/env node
import { BigentAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { runLoopedPrompt } from "./loop.js";
import { TelegramBridge } from "./telegram.js";
import { runServiceAction, serviceLogs } from "./service.js";
import { updateAgentAndPi, updatePiDependency } from "./update-pi.js";
import { uninstallBigent } from "./uninstall.js";
import { webSearch } from "./tools.js";

const HELP = `BIgent - Behzat Industries Agent

Usage:
  bigent ask <prompt...>       Run one prompt through Pi
  bigent loop <prompt...>      Run a bounded agentic loop for larger tasks
  bigent search <query...>     Test BIgent web search directly
  bigent telegram              Run the Telegram bot bridge
  bigent service <action>      Manage user systemd Telegram service
  bigent update                Update BIgent source and Pi SDK
  bigent update-pi [--commit]  One-click update to the latest Pi SDK
  bigent uninstall [--purge]   Remove BIgent install, service, and optionally config/state
  bigent help                  Show this help

Environment:
  TELEGRAM_BOT_TOKEN           Telegram bot token for telegram mode
  BIGENT_TELEGRAM_ALLOWLIST    Comma-separated allowed user/chat IDs
  BIGENT_CWD                   Optional working directory for Pi sessions
  BIGENT_HOME                  Optional BIgent state dir, defaults to ~/.bigent
  BIGENT_PI_PROVIDER           Optional Pi provider override
  BIGENT_PI_MODEL              Optional Pi model override
  BIGENT_PI_API_PROVIDER       Optional provider id for BIGENT_PI_API_KEY
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
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });
    const answer = await agent.prompt(prompt);
    console.log(answer || "Done.");
    return;
  }

  if (command === "loop") {
    const prompt = args.join(" ").trim();
    if (!prompt) {
      throw new Error("Usage: bigent loop <prompt...>");
    }
    const agent = new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      piProvider: config.piProvider,
      piModel: config.piModel,
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });
    const result = await runLoopedPrompt(agent, prompt, {
      onProgress: (event) => {
        if (event.stage === "start") {
          console.error(`loop start: 0/${event.maxTurns}`);
          return;
        }
        if (event.stage === "before_turn") {
          console.error(`loop turn ${event.turn}/${event.maxTurns}: thinking`);
          return;
        }
        if (event.stage === "after_turn") {
          console.error(`loop turn ${event.turn}/${event.maxTurns}: ${event.status}`);
          return;
        }
        console.error(`loop ${event.stage}: ${event.turn}/${event.maxTurns}`);
      },
    });
    console.log(result.answer || "Done.");
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

  if (command === "service") {
    const action = args[0] ?? "status";
    if (action === "--help" || action === "-h") {
      console.log("Usage: bigent service start|stop|restart|status|logs|enable|disable");
      return;
    }
    if (action === "logs") {
      console.log(serviceLogs());
      return;
    }
    if (!["start", "stop", "restart", "status", "enable", "disable"].includes(action)) {
      throw new Error("Usage: bigent service start|stop|restart|status|logs|enable|disable");
    }
    console.log(runServiceAction(action as "start" | "stop" | "restart" | "status" | "enable" | "disable"));
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

  if (command === "uninstall") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: bigent uninstall [--purge]");
      return;
    }
    const unsupported = args.filter((arg) => arg !== "--purge");
    if (unsupported.length > 0) {
      throw new Error(`Unsupported uninstall option: ${unsupported.join(", ")}`);
    }
    console.log(await uninstallBigent({ purge: args.includes("--purge") }));
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

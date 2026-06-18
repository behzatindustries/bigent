import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { BigentAgent } from "./agent.js";
import type { BigentConfig } from "./config.js";
import { runLoopedPrompt } from "./loop.js";

export async function runChatTui(config: BigentConfig): Promise<void> {
  const rl = readline.createInterface({ input, output, prompt: "bigent> " });
  let sessionName = "tui";

  const createAgent = (): BigentAgent =>
    new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      sessionScope: `tui-${sessionName}`,
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });

  console.log("BIgent chat TUI. Commands: /help, /loop <prompt>, /new [name], /status, /exit");
  rl.prompt();

  try {
    for await (const line of rl) {
      const text = line.trim();
      if (!text) {
        rl.prompt();
        continue;
      }

      try {
        if (text === "/exit" || text === "/quit") break;
        if (text === "/help") {
          console.log("Commands: /loop <prompt>, /new [name], /status, /exit");
          rl.prompt();
          continue;
        }
        if (text === "/status") {
          console.log(`cwd: ${config.cwd}`);
          console.log(`home: ${config.homeDir}`);
          console.log(`session: ${sessionName}`);
          console.log(`thinking: ${config.piThinking ?? "Pi default"}`);
          console.log(`api provider: ${config.piApiProvider ?? "Pi default"}`);
          rl.prompt();
          continue;
        }
        if (text.startsWith("/new")) {
          sessionName = normalizeTuiSession(text.slice(4).trim() || `chat-${Date.now()}`);
          console.log(`New session: ${sessionName}`);
          rl.prompt();
          continue;
        }
        if (text.startsWith("/loop ")) {
          const prompt = text.slice(6).trim();
          const result = await runLoopedPrompt(createAgent(), prompt, {
            maxTurns: config.loopMaxTurns,
            onProgress: (event) => {
              if (event.stage === "before_turn") {
                process.stderr.write(`\rloop ${event.turn}/${event.maxTurns}: thinking...`);
              }
              if (event.stage === "tool_start") {
                process.stderr.write(`\rloop ${event.turn}/${event.maxTurns}: ${event.tool} started`);
              }
              if (event.stage === "tool_end") {
                process.stderr.write(`\rloop ${event.turn}/${event.maxTurns}: ${event.tool} ${event.status}`);
              }
            },
          });
          process.stderr.write("\n");
          console.log(result.answer || "Done.");
          rl.prompt();
          continue;
        }
        if (text.startsWith("/")) {
          console.log("Unknown command. Use /help.");
          rl.prompt();
          continue;
        }

        const answer = await createAgent().prompt(text, {
          onEvent: (event) => {
            if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
              process.stderr.write(`\n[tool] ${event.toolName} started\n`);
            }
            if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
              process.stderr.write(`[tool] ${event.toolName} ${event.isError ? "failed" : "done"}\n`);
            }
          },
        });
        console.log(answer || "Done.");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }

      rl.prompt();
    }
  } finally {
    rl.close();
  }
}

function normalizeTuiSession(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "tui";
}

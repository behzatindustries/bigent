import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { BigentAgent } from "./agent.js";
import type { BigentConfig } from "./config.js";
import { runLoopedPrompt } from "./loop.js";
import { MemoryStore, renderMemories } from "./memory.js";

export async function runChatTui(config: BigentConfig): Promise<void> {
  await fs.mkdir(config.homeDir, { recursive: true });
  const historyPath = path.join(config.homeDir, "tui-history.txt");
  const rl = readline.createInterface({ input, output, prompt: "bigent> " });
  const memory = new MemoryStore(config.homeDir);
  let sessionName = "tui";

  try {
    const history = await fs.readFile(historyPath, "utf8");
    (rl as unknown as { history: string[] }).history = history.split("\n").filter(Boolean).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const createAgent = (): BigentAgent =>
    new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      sessionScope: `tui-${sessionName}`,
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });

  console.log("BIgent chat TUI. Commands: /help, /loop <prompt>, /memory ..., /new [name], /status, /exit");
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
          console.log("Commands: /loop <prompt>, /memory add|search|list|delete, /new [name], /status, /exit");
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
        if (text.startsWith("/memory")) {
          await handleMemoryCommand(memory, text);
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

        let streamed = false;
        const answer = await createAgent().prompt(text, {
          onEvent: (event) => {
            if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
              if (streamed) output.write("\n");
              process.stderr.write(`[tool] ${event.toolName} started\n`);
            }
            if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
              process.stderr.write(`[tool] ${event.toolName} ${event.isError ? "failed" : "done"}\n`);
            }
            if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
              output.write(event.assistantMessageEvent.delta ?? "");
              streamed = true;
            }
          },
        });
        if (streamed) output.write("\n");
        else console.log(answer || "Done.");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }

      rl.prompt();
    }
  } finally {
    await fs.writeFile(historyPath, [...((rl as unknown as { history: string[] }).history ?? [])].reverse().join("\n"), { mode: 0o600 });
    rl.close();
  }
}

async function handleMemoryCommand(memory: MemoryStore, line: string): Promise<void> {
  const [, action = "list", ...parts] = line.split(/\s+/);
  const value = parts.join(" ").trim();
  if (action === "add") {
    const entry = await memory.add(value, { source: "tui" });
    console.log(`saved: ${entry.id}`);
    return;
  }
  if (action === "search") {
    console.log(renderMemories(await memory.search(value, 10)));
    return;
  }
  if (action === "list") {
    console.log(renderMemories(await memory.list(10)));
    return;
  }
  if (action === "delete") {
    if (!value) throw new Error("Usage: /memory delete <id>");
    console.log((await memory.delete(value)) ? `deleted: ${value}` : `not found: ${value}`);
    return;
  }
  console.log("Usage: /memory add <text> | /memory search <query> | /memory list | /memory delete <id>");
}

function normalizeTuiSession(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "tui";
}

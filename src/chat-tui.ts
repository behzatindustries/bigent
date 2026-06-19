import blessed from "blessed";
import fs from "node:fs/promises";
import path from "node:path";
import { BigentAgent } from "./agent.js";
import type { BigentConfig } from "./config.js";
import { runLoopedPrompt } from "./loop.js";
import { MemoryStore, renderMemories } from "./memory.js";

type Role = "user" | "assistant" | "system" | "tool";
type CommandSpec = { name: string; usage: string; description: string; run: (arg: string) => Promise<void> };

export async function runChatTui(config: BigentConfig): Promise<void> {
  await fs.mkdir(config.homeDir, { recursive: true });
  const historyPath = path.join(config.homeDir, "tui-history.txt");
  const memory = new MemoryStore(config.homeDir);
  let sessionName = "tui";
  let busy = false;
  let history = await readHistory(historyPath);
  let historyIndex = history.length;
  let closed = false;

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: "BIgent" });
  const header = blessed.box({ top: 0, height: 1, width: "100%", tags: true, style: { bg: "blue", fg: "white" } });
  const transcript = blessed.log({ top: 1, bottom: 5, width: "100%", tags: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true, scrollbar: { ch: " ", style: { bg: "blue" } } });
  const hint = blessed.box({ bottom: 4, height: 1, width: "100%", tags: true, style: { fg: "gray" } });
  const input = blessed.textbox({ bottom: 0, height: 4, width: "100%", border: "line", inputOnFocus: true, keys: true, mouse: true, style: { border: { fg: "cyan" } } });
  screen.append(header);
  screen.append(transcript);
  screen.append(hint);
  screen.append(input);

  const createAgent = () =>
    new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      sessionScope: `tui-${sessionName}`,
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });

  const commands: CommandSpec[] = [
    { name: "/help", usage: "/help", description: "show commands", run: async () => add("system", renderHelp(commands)) },
    { name: "/exit", usage: "/exit", description: "quit", run: async () => quit() },
    { name: "/quit", usage: "/quit", description: "quit", run: async () => quit() },
    { name: "/new", usage: "/new [name]", description: "start/switch session", run: async (arg) => { sessionName = normalizeTuiSession(arg || `chat-${Date.now()}`); add("system", `session: ${sessionName}`); } },
    { name: "/status", usage: "/status", description: "show config", run: async () => add("system", [`cwd: ${config.cwd}`, `home: ${config.homeDir}`, `session: ${sessionName}`, `thinking: ${config.piThinking ?? "Pi default"}`, `api provider: ${config.piApiProvider ?? "Pi default"}`].join("\n")) },
    { name: "/memory", usage: "/memory add|search|list|delete ...", description: "persistent memory", run: async (arg) => handleMemory(memory, arg, add) },
    {
      name: "/loop",
      usage: "/loop <prompt>",
      description: "bounded loop mode",
      run: async (arg) => {
        if (!arg) return add("system", "Usage: /loop <prompt>");
        add("user", `/loop ${arg}`);
        busy = true;
        updateHeader("loop running");
        try {
          const result = await runLoopedPrompt(createAgent(), arg, {
            maxTurns: config.loopMaxTurns,
            onProgress: (event) => {
              if (event.stage === "tool_start") add("tool", `${event.tool} started`);
              if (event.stage === "tool_end") add("tool", `${event.tool} ${event.status}`);
              updateHeader(`loop ${event.turn}/${event.maxTurns}: ${event.stage}`);
            },
          });
          add("assistant", result.answer || "Done.");
          updateHeader(`loop ${result.status}`);
        } finally {
          busy = false;
          updateHeader("ready");
        }
      },
    },
  ];

  function updateHeader(status = busy ? "busy" : "ready") {
    header.setContent(` BIgent ${busy ? "●" : "○"}  session:${sessionName}  ${status}`);
    screen.render();
  }

  function add(role: Role, text: string) {
    const label = role === "user" ? "{cyan-fg}you{/}" : role === "assistant" ? "{green-fg}bigent{/}" : role === "tool" ? "{yellow-fg}tool{/}" : "{gray-fg}sys{/}";
    transcript.log(`${label} ${escapeTags(text)}`);
    screen.render();
  }

  function updateHint() {
    const value = String(input.getValue() ?? "");
    const s = suggestion(value);
    hint.setContent(s ? `Tab: ${s.usage} — ${s.description}` : "Enter send · Shift+Enter newline · Tab complete slash command · Up/Down history · PgUp/PgDn scroll · Ctrl-C quit");
    screen.render();
  }

  function suggestion(value: string) {
    if (!value.startsWith("/")) return undefined;
    const first = value.split(/\s+/)[0].toLowerCase();
    return commands.find((command) => command.name.startsWith(first) && command.name !== first) ?? commands.find((command) => command.name === first);
  }

  function refocusInput() {
    if (closed) return;
    input.focus();
    const reader = input as unknown as { readInput?: (callback?: () => void) => void };
    try {
      reader.readInput?.(() => undefined);
    } catch {
      // blessed throws if the textbox is already reading; focus is enough in that case.
    }
    screen.render();
  }

  async function submit() {
    if (busy) return refocusInput();
    const text = String(input.getValue() ?? "").trim();
    if (!text) return refocusInput();
    input.clearValue();
    history.push(text);
    history = history.slice(-200);
    historyIndex = history.length;
    updateHint();

    if (text.startsWith("/")) {
      const [raw, ...rest] = text.split(/\s+/);
      const command = commands.find((entry) => entry.name === raw.toLowerCase());
      if (!command) add("system", `Unknown command: ${raw}`);
      else await command.run(rest.join(" ").trim());
      refocusInput();
      return;
    }

    add("user", text);
    busy = true;
    updateHeader("thinking");
    let assistantText = "";
    try {
      const answer = await createAgent().prompt(text, {
        onEvent: (event) => {
          if (event.type === "tool_execution_start" && typeof event.toolName === "string") add("tool", `${event.toolName} started`);
          if (event.type === "tool_execution_end" && typeof event.toolName === "string") add("tool", `${event.toolName} ${event.isError ? "failed" : "done"}`);
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            assistantText += event.assistantMessageEvent.delta ?? "";
            updateHeader("streaming");
          }
        },
      });
      add("assistant", assistantText.trim() || answer || "Done.");
    } catch (error) {
      add("system", error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      updateHeader("ready");
      refocusInput();
    }
  }

  async function quit() {
    if (closed) return;
    closed = true;
    process.removeListener("SIGINT", onSigint);
    await fs.writeFile(historyPath, `${history.join("\n")}\n`, { mode: 0o600 });
    screen.destroy();
  }

  input.on("submit", () => void submit());
  input.key(["C-c", "C-d"], () => void quit());
  input.key("tab", () => {
    const value = String(input.getValue() ?? "");
    const s = suggestion(value);
    if (s && !value.includes(" ")) input.setValue(`${s.name} `);
    input.focus();
    updateHint();
  });
  input.key("up", () => { historyIndex = Math.max(0, historyIndex - 1); input.setValue(history[historyIndex] ?? ""); input.focus(); updateHint(); });
  input.key("down", () => { historyIndex = Math.min(history.length, historyIndex + 1); input.setValue(history[historyIndex] ?? ""); input.focus(); updateHint(); });
  input.on("keypress", () => setTimeout(updateHint, 0));
  screen.key(["C-c", "C-d"], () => void quit());
  screen.key(["pageup"], () => { transcript.scroll(-5); screen.render(); });
  screen.key(["pagedown"], () => { transcript.scroll(5); screen.render(); });

  const onSigint = () => void quit();
  process.once("SIGINT", onSigint);
  add("system", "BIgent TUI. Type / for commands, Tab to complete.");
  updateHeader("ready");
  updateHint();
  refocusInput();
  await new Promise<void>((resolve) => screen.on("destroy", resolve));
}

async function handleMemory(memory: MemoryStore, arg: string, add: (role: Role, text: string) => void): Promise<void> {
  const [action = "list", ...parts] = arg.split(/\s+/).filter(Boolean);
  const value = parts.join(" ").trim();
  if (action === "add") add("system", `saved: ${(await memory.add(value, { source: "tui" })).id}`);
  else if (action === "search") add("system", renderMemories(await memory.search(value, 10)));
  else if (action === "list") add("system", renderMemories(await memory.list(10)));
  else if (action === "delete") add("system", value && (await memory.delete(value)) ? `deleted: ${value}` : `not found: ${value}`);
  else add("system", "Usage: /memory add <text> | /memory search <query> | /memory list | /memory delete <id>");
}

async function readHistory(historyPath: string): Promise<string[]> {
  try {
    return (await fs.readFile(historyPath, "utf8")).split("\n").filter(Boolean).slice(-200);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function renderHelp(commands: CommandSpec[]): string {
  return commands.map((command) => `${command.usage.padEnd(30)} ${command.description}`).join("\n");
}

function escapeTags(value: string): string {
  return value.replace(/[{}]/g, "");
}

function normalizeTuiSession(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "tui";
}

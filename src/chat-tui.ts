import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { BigentAgent } from "./agent.js";
import type { BigentConfig } from "./config.js";
import { runLoopedPrompt } from "./loop.js";
import { MemoryStore, renderMemories } from "./memory.js";

type Role = "user" | "assistant" | "system" | "tool";
type ChatLine = { role: Role; text: string };
type Key = { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean };

type CommandSpec = {
  name: string;
  usage: string;
  description: string;
  run: (arg: string) => Promise<void>;
};

const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ALT_SCREEN = "\x1b[?1049h";
const MAIN_SCREEN = "\x1b[?1049l";

export async function runChatTui(config: BigentConfig): Promise<void> {
  await fs.mkdir(config.homeDir, { recursive: true });
  const historyPath = path.join(config.homeDir, "tui-history.txt");
  const memory = new MemoryStore(config.homeDir);
  const messages: ChatLine[] = [
    { role: "system", text: "BIgent TUI. Type / for commands, Tab to accept prediction, Ctrl-C or /exit to quit." },
  ];
  let sessionName = "tui";
  let draft = "";
  let cursor = 0;
  let status = "ready";
  let busy = false;
  let scroll = 0;
  let history = await readHistory(historyPath);
  let historyIndex = history.length;
  let closed = false;
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const createAgent = (): BigentAgent =>
    new BigentAgent({
      homeDir: config.homeDir,
      cwd: config.cwd,
      sessionScope: `tui-${sessionName}`,
      piApiProvider: config.piApiProvider,
      piApiKey: config.piApiKey,
      piThinking: config.piThinking,
    });

  const commands: CommandSpec[] = [
    { name: "/help", usage: "/help", description: "show commands", run: async () => push("system", renderHelp(commands)) },
    { name: "/exit", usage: "/exit", description: "quit", run: async () => close() },
    { name: "/quit", usage: "/quit", description: "quit", run: async () => close() },
    {
      name: "/new",
      usage: "/new [name]",
      description: "start/switch terminal session",
      run: async (arg) => {
        sessionName = normalizeTuiSession(arg || `chat-${Date.now()}`);
        push("system", `session: ${sessionName}`);
      },
    },
    {
      name: "/status",
      usage: "/status",
      description: "show active config",
      run: async () =>
        push(
          "system",
          [`cwd: ${config.cwd}`, `home: ${config.homeDir}`, `session: ${sessionName}`, `thinking: ${config.piThinking ?? "Pi default"}`, `api provider: ${config.piApiProvider ?? "Pi default"}`].join("\n"),
        ),
    },
    {
      name: "/loop",
      usage: "/loop <prompt>",
      description: "run bounded loop mode",
      run: async (arg) => {
        if (!arg) return push("system", "Usage: /loop <prompt>");
        push("user", `/loop ${arg}`);
        busy = true;
        status = "loop running";
        render();
        try {
          const result = await runLoopedPrompt(createAgent(), arg, {
            maxTurns: config.loopMaxTurns,
            onProgress: (event) => {
              if (event.stage === "tool_start") push("tool", `${event.tool} started`);
              if (event.stage === "tool_end") push("tool", `${event.tool} ${event.status}`);
              status = `loop ${event.turn}/${event.maxTurns}: ${event.stage}`;
              render();
            },
          });
          push("assistant", result.answer || "Done.");
          status = `loop ${result.status}`;
        } finally {
          busy = false;
        }
      },
    },
    {
      name: "/memory",
      usage: "/memory add|search|list|delete ...",
      description: "manage persistent memory",
      run: async (arg) => handleMemory(memory, arg, push),
    },
  ];

  function push(role: Role, text: string): void {
    messages.push({ role, text });
    scroll = 0;
    render();
  }

  function suggestion(): CommandSpec | undefined {
    if (!draft.startsWith("/")) return undefined;
    const first = draft.split(/\s+/)[0].toLowerCase();
    return commands.find((command) => command.name.startsWith(first) && command.name !== first) ?? commands.find((command) => command.name === first);
  }

  function render(): void {
    const width = Math.max(40, output.columns || 80);
    const height = Math.max(16, output.rows || 24);
    const transcriptHeight = height - 7;
    const allLines = renderTranscript(messages, width - 2);
    const visible = allLines.slice(Math.max(0, allLines.length - transcriptHeight - scroll), allLines.length - scroll || undefined);
    const s = suggestion();
    const prediction = s && draft !== s.name && !draft.includes(" ") ? s.name.slice(draft.length) : "";
    const help = s ? `${s.usage} — ${s.description}` : "Enter send · Shift+Enter newline · Tab accept · PgUp/PgDn scroll · Ctrl-C quit";
    const inputLines = wrap(`${draft}${prediction ? dim(prediction) : ""}`, width - 6).slice(-2);

    output.write(CLEAR + HIDE_CURSOR);
    output.write(boxLine(` BIgent ${busy ? "●" : "○"}  session:${sessionName}  ${status} `, width));
    for (let i = 0; i < transcriptHeight; i += 1) output.write(`${pad(visible[i] ?? "", width)}\n`);
    output.write(boxLine(` ${help} `, width));
    output.write(`╭${"─".repeat(width - 2)}╮\n`);
    output.write(`│ ${pad(inputLines[0] ?? "", width - 4)} │\n`);
    output.write(`│ ${pad(inputLines[1] ?? "", width - 4)} │\n`);
    output.write(`╰${"─".repeat(width - 2)}╯`);
  }

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || busy) return;
    draft = "";
    cursor = 0;
    history.push(text);
    history = history.slice(-200);
    historyIndex = history.length;

    if (text.startsWith("/")) {
      const [raw, ...rest] = text.split(/\s+/);
      const command = commands.find((entry) => entry.name === raw.toLowerCase());
      if (!command) push("system", `Unknown command: ${raw}`);
      else await command.run(rest.join(" ").trim());
      render();
      return;
    }

    push("user", text);
    busy = true;
    status = "thinking";
    const assistantIndex = messages.push({ role: "assistant", text: "" }) - 1;
    render();
    try {
      const answer = await createAgent().prompt(text, {
        onEvent: (event) => {
          if (event.type === "tool_execution_start" && typeof event.toolName === "string") push("tool", `${event.toolName} started`);
          if (event.type === "tool_execution_end" && typeof event.toolName === "string") push("tool", `${event.toolName} ${event.isError ? "failed" : "done"}`);
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            messages[assistantIndex].text += event.assistantMessageEvent.delta ?? "";
            status = "streaming";
            render();
          }
        },
      });
      if (!messages[assistantIndex].text.trim()) messages[assistantIndex].text = answer || "Done.";
      status = "ready";
    } catch (error) {
      messages[assistantIndex] = { role: "system", text: error instanceof Error ? error.message : String(error) };
      status = "error";
    } finally {
      busy = false;
      render();
    }
  }

  async function close(): Promise<void> {
    closed = true;
    await fs.writeFile(historyPath, `${history.join("\n")}\n`, { mode: 0o600 });
    if (input.isTTY) input.setRawMode(false);
    output.off("resize", onResize);
    output.write(SHOW_CURSOR + MAIN_SCREEN + "\n");
    finish?.();
  }

  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  output.write(ALT_SCREEN);
  render();

  const onResize = () => render();
  output.on("resize", onResize);
  input.on("keypress", async (str: string, key: Key) => {
    if (closed) return;
    if (key.ctrl && key.name === "c") return close();
    if (busy) return;
    if (key.name === "return" || key.name === "enter") return submit();
    if (key.name === "tab") {
      const s = suggestion();
      if (s && !draft.includes(" ")) {
        draft = `${s.name} `;
        cursor = draft.length;
      }
      return render();
    }
    if (key.name === "backspace") {
      if (cursor > 0) {
        draft = draft.slice(0, cursor - 1) + draft.slice(cursor);
        cursor -= 1;
      }
      return render();
    }
    if (key.name === "delete") {
      draft = draft.slice(0, cursor) + draft.slice(cursor + 1);
      return render();
    }
    if (key.name === "left") cursor = Math.max(0, cursor - 1);
    else if (key.name === "right") cursor = Math.min(draft.length, cursor + 1);
    else if (key.name === "home") cursor = 0;
    else if (key.name === "end") cursor = draft.length;
    else if (key.name === "up") {
      historyIndex = Math.max(0, historyIndex - 1);
      draft = history[historyIndex] ?? draft;
      cursor = draft.length;
    } else if (key.name === "down") {
      historyIndex = Math.min(history.length, historyIndex + 1);
      draft = history[historyIndex] ?? "";
      cursor = draft.length;
    } else if (key.name === "pageup") scroll += 5;
    else if (key.name === "pagedown") scroll = Math.max(0, scroll - 5);
    else if (key.sequence === "\r" && key.shift) {
      draft = draft.slice(0, cursor) + "\n" + draft.slice(cursor);
      cursor += 1;
    } else if (str && !key.ctrl && !key.meta) {
      draft = draft.slice(0, cursor) + str + draft.slice(cursor);
      cursor += str.length;
    }
    render();
  });

  await done;
}

async function handleMemory(memory: MemoryStore, arg: string, push: (role: Role, text: string) => void): Promise<void> {
  const [action = "list", ...parts] = arg.split(/\s+/).filter(Boolean);
  const value = parts.join(" ").trim();
  if (action === "add") push("system", `saved: ${(await memory.add(value, { source: "tui" })).id}`);
  else if (action === "search") push("system", renderMemories(await memory.search(value, 10)));
  else if (action === "list") push("system", renderMemories(await memory.list(10)));
  else if (action === "delete") push("system", value && (await memory.delete(value)) ? `deleted: ${value}` : `not found: ${value}`);
  else push("system", "Usage: /memory add <text> | /memory search <query> | /memory list | /memory delete <id>");
}

async function readHistory(historyPath: string): Promise<string[]> {
  try {
    return (await fs.readFile(historyPath, "utf8")).split("\n").filter(Boolean).slice(-200);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function renderTranscript(messages: ChatLine[], width: number): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    const label = message.role === "user" ? cyan("you") : message.role === "assistant" ? green("bigent") : message.role === "tool" ? yellow("tool") : dim("sys");
    const wrapped = wrap(message.text || " ", Math.max(10, width - 10));
    lines.push(`${label} ${wrapped[0] ?? ""}`);
    for (const line of wrapped.slice(1)) lines.push(`    ${line}`);
    lines.push("");
  }
  return lines;
}

function renderHelp(commands: CommandSpec[]): string {
  return commands.map((command) => `${command.usage.padEnd(28)} ${command.description}`).join("\n");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    while (visibleLength(line) > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
    out.push(line);
  }
  return out;
}

function boxLine(text: string, width: number): string {
  const inner = text.slice(0, width - 2);
  return `╭${pad(inner, width - 2, "─")}╮\n`;
}

function pad(value: string, width: number, fill = " "): string {
  const visible = visibleLength(value);
  return visible >= width ? value.slice(0, width) : value + fill.repeat(width - visible);
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function cyan(value: string): string {
  return `\x1b[36m${value}\x1b[0m`;
}
function green(value: string): string {
  return `\x1b[32m${value}\x1b[0m`;
}
function yellow(value: string): string {
  return `\x1b[33m${value}\x1b[0m`;
}
function dim(value: string): string {
  return `\x1b[2m${value}\x1b[0m`;
}

function normalizeTuiSession(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "tui";
}

import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  CONFIG_ENV_PATH,
  THINKING_LEVELS,
  getConfigEnv,
  maskSecret,
  readConfigEnv,
  writeConfigEnv,
  type ConfigEnv,
  type ConfigEnvKey,
} from "./config.js";

type Field = {
  key: ConfigEnvKey;
  label: string;
  help: string;
  secret?: boolean;
  choices?: readonly string[];
  validate?: (value: string) => string | undefined;
};

type Key = { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean };

const FIELDS: Field[] = [
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", help: "BotFather token for Telegram mode", secret: true },
  { key: "BIGENT_TELEGRAM_ALLOWLIST", label: "Telegram allowlist", help: "Comma-separated Telegram user/chat IDs" },
  { key: "BIGENT_CWD", label: "Working directory", help: "Directory where BIgent/Pi should work" },
  { key: "BIGENT_HOME", label: "State directory", help: "BIgent state, sessions, auth, memory" },
  { key: "BIGENT_PI_API_PROVIDER", label: "Pi API provider", help: "Provider id for runtime API key" },
  { key: "BIGENT_PI_API_KEY", label: "Pi API key", help: "Runtime API key for provider", secret: true },
  {
    key: "BIGENT_PI_THINKING",
    label: "Pi thinking",
    help: "Thinking effort override",
    choices: THINKING_LEVELS,
    validate: (value) => (!value || THINKING_LEVELS.includes(value as never) ? undefined : `Use one of: ${THINKING_LEVELS.join(", ")}`),
  },
  {
    key: "BIGENT_LOOP_MAX_TURNS",
    label: "Loop max turns",
    help: "Max turns for bigent loop and Telegram /loop",
    validate: (value) => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 ? undefined : "Enter a positive integer.";
    },
  },
];

const ALT_SCREEN = "\x1b[?1049h";
const MAIN_SCREEN = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export async function runConfigTui(): Promise<void> {
  const fileValues = readConfigEnv();
  const effectiveValues = getConfigEnv();
  const values: ConfigEnv = { ...fileValues };
  let selected = 0;
  let dirty = false;
  let message = "Enter edit · Space cycle choices · d clear · s save · q quit";
  let editing: { field: Field; text: string; cursor: number } | undefined;
  let closed = false;
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));

  function render(): void {
    const width = Math.max(70, output.columns || 90);
    const height = Math.max(20, output.rows || 24);
    output.write(CLEAR + HIDE_CURSOR);
    output.write(`╭${"─".repeat(width - 2)}╮\n`);
    output.write(`│ ${pad("BIgent configuration", width - 4)} │\n`);
    output.write(`│ ${pad(CONFIG_ENV_PATH, width - 4)} │\n`);
    output.write(`├${"─".repeat(width - 2)}┤\n`);

    const bodyHeight = height - 9;
    const start = Math.max(0, Math.min(selected - Math.floor(bodyHeight / 2), FIELDS.length - bodyHeight));
    for (let index = start; index < Math.min(FIELDS.length, start + bodyHeight); index += 1) {
      const field = FIELDS[index];
      const marker = index === selected ? "▶" : " ";
      const envOverride = effectiveValues[field.key] !== undefined && effectiveValues[field.key] !== values[field.key];
      const value = formatValue(values[field.key], field.secret);
      const suffix = envOverride ? dim(" env override") : "";
      const line = `${marker} ${field.label.padEnd(22)} ${value}${suffix}`;
      output.write(`│ ${pad(index === selected ? inverse(line) : line, width - 4)} │\n`);
    }
    for (let i = Math.min(FIELDS.length, start + bodyHeight); i < start + bodyHeight; i += 1) {
      output.write(`│ ${" ".repeat(width - 4)} │\n`);
    }

    const field = FIELDS[selected];
    output.write(`├${"─".repeat(width - 2)}┤\n`);
    output.write(`│ ${pad(field.help, width - 4)} │\n`);
    output.write(`│ ${pad(message + (dirty ? "  *unsaved" : ""), width - 4)} │\n`);
    output.write(`╰${"─".repeat(width - 2)}╯`);

    if (editing) renderEditor(width, editing);
  }

  function renderEditor(width: number, edit: { field: Field; text: string }): void {
    const boxWidth = Math.min(width - 8, 82);
    const left = Math.max(1, Math.floor((width - boxWidth) / 2));
    const top = 7;
    const value = edit.field.secret ? maskSecret(edit.text) : edit.text;
    move(top, left);
    output.write(`╭${"─".repeat(boxWidth - 2)}╮`);
    move(top + 1, left);
    output.write(`│ ${pad(`Edit ${edit.field.label}`, boxWidth - 4)} │`);
    move(top + 2, left);
    output.write(`├${"─".repeat(boxWidth - 2)}┤`);
    move(top + 3, left);
    output.write(`│ ${pad(value, boxWidth - 4)} │`);
    move(top + 4, left);
    output.write(`│ ${pad("Enter save · Esc cancel · Ctrl-U clear", boxWidth - 4)} │`);
    move(top + 5, left);
    output.write(`╰${"─".repeat(boxWidth - 2)}╯`);
  }

  function close(): void {
    closed = true;
    output.off("resize", render);
    if (input.isTTY) input.setRawMode(false);
    output.write(SHOW_CURSOR + MAIN_SCREEN + "\n");
    finish?.();
  }

  function save(): void {
    for (const field of FIELDS) {
      const error = field.validate?.(values[field.key] ?? "");
      if (error) {
        selected = FIELDS.indexOf(field);
        message = error;
        return;
      }
    }
    writeConfigEnv(values);
    dirty = false;
    message = `Saved ${CONFIG_ENV_PATH}`;
  }

  function cycleChoice(field: Field): void {
    if (!field.choices) return;
    const current = values[field.key] ?? "";
    const choices = ["", ...field.choices];
    values[field.key] = choices[(choices.indexOf(current) + 1) % choices.length];
    if (!values[field.key]) delete values[field.key];
    dirty = true;
    message = `${field.label}: ${values[field.key] || "unset"}`;
  }

  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  output.write(ALT_SCREEN);
  output.on("resize", render);
  render();

  input.on("keypress", (str: string, key: Key) => {
    if (closed) return;
    if (key.ctrl && key.name === "c") return close();

    if (editing) {
      if (key.name === "escape") {
        editing = undefined;
        message = "edit cancelled";
      } else if (key.name === "return" || key.name === "enter") {
        const error = editing.field.validate?.(editing.text.trim());
        if (error) message = error;
        else {
          if (editing.text.trim()) values[editing.field.key] = editing.text.trim();
          else delete values[editing.field.key];
          dirty = true;
          message = `${editing.field.label} updated`;
          editing = undefined;
        }
      } else if (key.ctrl && key.name === "u") {
        editing.text = "";
        editing.cursor = 0;
      } else if (key.name === "backspace") {
        if (editing.cursor > 0) {
          editing.text = editing.text.slice(0, editing.cursor - 1) + editing.text.slice(editing.cursor);
          editing.cursor -= 1;
        }
      } else if (key.name === "delete") {
        editing.text = editing.text.slice(0, editing.cursor) + editing.text.slice(editing.cursor + 1);
      } else if (key.name === "left") editing.cursor = Math.max(0, editing.cursor - 1);
      else if (key.name === "right") editing.cursor = Math.min(editing.text.length, editing.cursor + 1);
      else if (str && !key.ctrl && !key.meta) {
        editing.text = editing.text.slice(0, editing.cursor) + str + editing.text.slice(editing.cursor);
        editing.cursor += str.length;
      }
      render();
      return;
    }

    if (key.name === "q" || key.name === "escape") {
      if (dirty) {
        message = "Unsaved changes. Press s to save or Ctrl-C to quit.";
      } else close();
    } else if (key.name === "up" || key.name === "k") selected = Math.max(0, selected - 1);
    else if (key.name === "down" || key.name === "j") selected = Math.min(FIELDS.length - 1, selected + 1);
    else if (key.name === "return" || key.name === "enter") {
      const field = FIELDS[selected];
      editing = { field, text: values[field.key] ?? "", cursor: (values[field.key] ?? "").length };
      message = `editing ${field.label}`;
    } else if (key.name === "space") cycleChoice(FIELDS[selected]);
    else if (key.name === "d" || key.name === "backspace") {
      delete values[FIELDS[selected].key];
      dirty = true;
      message = `${FIELDS[selected].label} cleared`;
    } else if (key.name === "s") save();
    else if (key.name === "r") {
      Object.keys(values).forEach((key) => delete values[key as ConfigEnvKey]);
      Object.assign(values, readConfigEnv());
      dirty = false;
      message = "reloaded file values";
    }
    render();
  });

  await done;
}

function formatValue(value: string | undefined, secret?: boolean): string {
  if (!value) return dim("unset");
  return secret ? maskSecret(value) : value;
}

function pad(value: string, width: number): string {
  const visible = visibleLength(value);
  return visible >= width ? value.slice(0, width) : value + " ".repeat(width - visible);
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function inverse(value: string): string {
  return `\x1b[7m${value}\x1b[0m`;
}

function dim(value: string): string {
  return `\x1b[2m${value}\x1b[0m`;
}

function move(row: number, col: number): void {
  output.write(`\x1b[${row};${col}H`);
}

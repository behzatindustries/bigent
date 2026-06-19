import blessed from "blessed";
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

export async function runConfigTui(): Promise<void> {
  const effectiveValues = getConfigEnv();
  const values: ConfigEnv = { ...readConfigEnv() };
  let dirty = false;
  let selected = 0;
  let closed = false;
  let lastMessage = "Enter edit · Space cycle choices · d clear · s save · r reload · q quit";

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: "BIgent config" });
  const title = blessed.box({ top: 0, height: 3, left: 0, right: 0, border: "line", tags: true, style: { border: { fg: "cyan" } } });
  const body = blessed.box({ top: 3, bottom: 4, left: 0, right: 0, border: "line", tags: true, keys: true, mouse: true, scrollable: false, style: { border: { fg: "cyan" } } });
  const help = blessed.box({ bottom: 1, height: 3, left: 0, right: 0, border: "line", tags: true, style: { border: { fg: "gray" } } });
  const status = blessed.box({ bottom: 0, height: 1, left: 0, right: 0, tags: true, style: { bg: "blue", fg: "white" } });
  screen.append(title);
  screen.append(body);
  screen.append(help);
  screen.append(status);

  function render(message = lastMessage): void {
    lastMessage = message;
    title.setContent(`{bold}BIgent configuration{/bold}\n${escapeTags(CONFIG_ENV_PATH)}`);
    const rows = FIELDS.map((field, index) => {
      const marker = index === selected ? "▶" : " ";
      const value = formatValue(values[field.key], field.secret);
      const envOverride = effectiveValues[field.key] !== undefined && effectiveValues[field.key] !== values[field.key] ? " env override" : "";
      const line = `${marker} ${field.label.padEnd(24)} ${value}${envOverride}`;
      return index === selected ? `{blue-bg}{white-fg}${escapeTags(line)}{/}` : escapeTags(line);
    });
    body.setContent(rows.join("\n"));
    help.setContent(`${escapeTags(FIELDS[selected].help)}\n${escapeTags(message)}`);
    status.setContent(` ${dirty ? "● unsaved" : "○ saved"}  ${escapeTags(CONFIG_ENV_PATH)}`);
    screen.render();
  }

  function validateAll(): string | undefined {
    for (const field of FIELDS) {
      const error = field.validate?.(values[field.key] ?? "");
      if (error) {
        selected = FIELDS.indexOf(field);
        return error;
      }
    }
    return undefined;
  }

  function save(): void {
    const error = validateAll();
    if (error) return render(error);
    writeConfigEnv(values);
    dirty = false;
    render(`Saved ${CONFIG_ENV_PATH}`);
  }

  function cycleChoice(field: Field): void {
    if (!field.choices) return render("This field has no choices; press Enter to edit.");
    const choices = ["", ...field.choices];
    const current = values[field.key] ?? "";
    const next = choices[(choices.indexOf(current) + 1) % choices.length];
    if (next) values[field.key] = next;
    else delete values[field.key];
    dirty = true;
    render(`${field.label}: ${next || "unset"}`);
  }

  function editField(field: Field): void {
    const prompt = blessed.prompt({
      parent: screen,
      border: "line",
      height: 9,
      width: "80%",
      top: "center",
      left: "center",
      label: ` ${field.label} `,
      tags: false,
      keys: true,
      vi: true,
      style: { border: { fg: "cyan" } },
    });
    prompt.input(`${field.help}\nValue:`, values[field.key] ?? "", (error, value) => {
      prompt.destroy();
      body.focus();
      if (error || value === null || value === undefined) return render("edit cancelled");
      const next = String(value).trim();
      const validation = field.validate?.(next);
      if (validation) return render(validation);
      if (next) values[field.key] = next;
      else delete values[field.key];
      dirty = true;
      render(`${field.label} updated`);
    });
  }

  function reload(): void {
    for (const key of Object.keys(values)) delete values[key as ConfigEnvKey];
    Object.assign(values, readConfigEnv());
    dirty = false;
    render("reloaded file values");
  }

  function quit(): void {
    if (closed) return;
    closed = true;
    process.removeListener("SIGINT", onSigint);
    screen.destroy();
  }

  function move(delta: number): void {
    selected = Math.max(0, Math.min(FIELDS.length - 1, selected + delta));
    render();
  }

  const onSigint = () => quit();
  process.once("SIGINT", onSigint);
  screen.key(["up", "k"], () => move(-1));
  screen.key(["down", "j"], () => move(1));
  screen.key(["enter"], () => editField(FIELDS[selected]));
  screen.key(["space"], () => cycleChoice(FIELDS[selected]));
  screen.key(["d", "backspace"], () => {
    delete values[FIELDS[selected].key];
    dirty = true;
    render(`${FIELDS[selected].label} cleared`);
  });
  screen.key(["s"], save);
  screen.key(["r"], reload);
  screen.key(["q", "escape"], () => (dirty ? render("Unsaved changes. Press s to save or Ctrl-C/Ctrl-D to quit without saving.") : quit()));
  screen.key(["C-c", "C-d"], quit);
  screen.on("resize", () => render());

  render();
  body.focus();
  await new Promise<void>((resolve) => screen.on("destroy", resolve));
}

function formatValue(value: string | undefined, secret?: boolean): string {
  if (!value) return "unset";
  return secret ? maskSecret(value) : value;
}

function escapeTags(value: string): string {
  return value.replace(/[{}]/g, "");
}

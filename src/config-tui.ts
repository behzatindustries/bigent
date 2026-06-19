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
  { key: "BIGENT_PI_THINKING", label: "Pi thinking", help: "Thinking effort override", choices: THINKING_LEVELS, validate: (value) => (!value || THINKING_LEVELS.includes(value as never) ? undefined : `Use one of: ${THINKING_LEVELS.join(", ")}`) },
  { key: "BIGENT_LOOP_MAX_TURNS", label: "Loop max turns", help: "Max turns for bigent loop and Telegram /loop", validate: (value) => !value || (Number.isInteger(Number.parseInt(value, 10)) && Number.parseInt(value, 10) > 0) ? undefined : "Enter a positive integer." },
];

export async function runConfigTui(): Promise<void> {
  const fileValues = readConfigEnv();
  const effectiveValues = getConfigEnv();
  const values: ConfigEnv = { ...fileValues };
  let dirty = false;
  let selected = 0;
  let closed = false;

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: "BIgent config" });
  const title = blessed.box({ top: 0, height: 3, width: "100%", border: "line", tags: true, content: `{bold}BIgent configuration{/bold}\n${CONFIG_ENV_PATH}`, style: { border: { fg: "cyan" } } });
  const list = blessed.list({ top: 3, bottom: 4, width: "100%", border: "line", keys: true, mouse: true, vi: true, tags: true, style: { selected: { bg: "blue", fg: "white" }, border: { fg: "cyan" } } });
  const help = blessed.box({ bottom: 1, height: 3, width: "100%", border: "line", tags: true, style: { border: { fg: "gray" } } });
  const status = blessed.box({ bottom: 0, height: 1, width: "100%", tags: true, style: { bg: "blue", fg: "white" } });
  screen.append(title);
  screen.append(list);
  screen.append(help);
  screen.append(status);

  function render(message = "Enter edit · Space cycle choices · d clear · s save · r reload · q quit") {
    list.setItems(FIELDS.map((field) => {
      const envOverride = effectiveValues[field.key] !== undefined && effectiveValues[field.key] !== values[field.key];
      return `${field.label.padEnd(24)} ${formatValue(values[field.key], field.secret)}${envOverride ? " {yellow-fg}env override{/}" : ""}`;
    }));
    list.select(selected);
    help.setContent(`${FIELDS[selected].help}\n${message}`);
    status.setContent(` ${dirty ? "● unsaved" : "○ saved"}  ${CONFIG_ENV_PATH}`);
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

  function save() {
    const error = validateAll();
    if (error) return render(error);
    writeConfigEnv(values);
    dirty = false;
    render(`Saved ${CONFIG_ENV_PATH}`);
  }

  function cycleChoice(field: Field) {
    if (!field.choices) return render("This field has no choices; press Enter to edit.");
    const choices = ["", ...field.choices];
    const current = values[field.key] ?? "";
    const next = choices[(choices.indexOf(current) + 1) % choices.length];
    if (next) values[field.key] = next;
    else delete values[field.key];
    dirty = true;
    render(`${field.label}: ${next || "unset"}`);
  }

  function editField(field: Field) {
    const prompt = blessed.prompt({ parent: screen, border: "line", height: 9, width: "80%", top: "center", left: "center", label: ` ${field.label} `, tags: true, keys: true, vi: true, style: { border: { fg: "cyan" } } });
    prompt.input(`${field.help}\nValue:`, values[field.key] ?? "", (error, value) => {
      prompt.destroy();
      list.focus();
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

  list.on("select", (_item, index) => {
    selected = index;
    editField(FIELDS[selected]);
  });
  list.on("select item", (_item, index) => {
    selected = index;
    render();
  });
  list.key(["up", "k"], () => { selected = Math.max(0, selected - 1); render(); });
  list.key(["down", "j"], () => { selected = Math.min(FIELDS.length - 1, selected + 1); render(); });
  screen.key(["space"], () => cycleChoice(FIELDS[selected]));
  screen.key(["d", "backspace"], () => { delete values[FIELDS[selected].key]; dirty = true; render(`${FIELDS[selected].label} cleared`); });
  screen.key(["s"], save);
  screen.key(["r"], () => { for (const key of Object.keys(values)) delete values[key as ConfigEnvKey]; Object.assign(values, readConfigEnv()); dirty = false; render("reloaded file values"); });
  function quit() {
    if (closed) return;
    closed = true;
    process.removeListener("SIGINT", onSigint);
    screen.destroy();
  }

  const onSigint = () => quit();
  process.once("SIGINT", onSigint);
  screen.key(["q", "escape"], () => dirty ? render("Unsaved changes. Press s to save or Ctrl-C/Ctrl-D to quit without saving.") : quit());
  screen.key(["C-c", "C-d"], quit);
  list.key(["C-c", "C-d"], quit);

  render();
  list.focus();
  await new Promise<void>((resolve) => screen.on("destroy", resolve));
}

function formatValue(value: string | undefined, secret?: boolean): string {
  if (!value) return "{gray-fg}unset{/}";
  return secret ? maskSecret(value) : value.replace(/[{}]/g, "");
}

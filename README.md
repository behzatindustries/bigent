# BIgent

BIgent means **Behzat Industries Agent**. It is a minimal Telegram-first agent built on top of the Pi coding agent SDK.

BIgent does not fork or edit Pi. Pi is an npm dependency, and the `bigent update-pi` command bumps the dependency to the newest SDK release and rebuilds the wrapper.

## Install

From GitHub:

```sh
git clone https://github.com/behzatindustries/bigent.git
cd bigent
npm install --ignore-scripts
npm run build
npm link
```

Without global npm permissions, use the hosted installer:

```sh
curl -fsSL https://behzat.org/install-bigent.sh | sh
```

Or run the same script from GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/behzatindustries/bigent/main/scripts/install-bigent.sh | sh
```

After install, the command is available as:

```sh
bigent help
```

The installer asks for:

- Telegram bot token
- Telegram allowlist user/chat ID, required so only that Telegram user/chat can talk to BIgent. Use a helper like `@userinfobot` if you do not know your ID.
- BIgent working directory
- BIgent state directory
- Pi provider API key
- Provider id for that API key, if an API key is entered
- Pi thinking level, optional

It writes those settings to `~/.config/bigent/bigent.env`.

BIgent uses Pi's default provider/model selection. Change provider/model through Pi itself; BIgent does not manage a separate provider/model override.

## Telegram

Create a Telegram bot with BotFather, then set:

```sh
export TELEGRAM_BOT_TOKEN="..."
export BIGENT_TELEGRAM_ALLOWLIST="123456789"
bigent telegram
```

If `BIGENT_TELEGRAM_ALLOWLIST` is empty, any Telegram chat that can reach the bot can use it.

The installer can also create and start a user systemd service:

```sh
systemctl --user status bigent-telegram.service
systemctl --user restart bigent-telegram.service
journalctl --user -u bigent-telegram.service -f
```

## CLI

```sh
bigent ask "inspect this repo and summarize the package"
bigent loop "inspect this repo, propose the next missing safety fix, and apply it"
bigent chat
bigent config
bigent search "latest Pi coding agent"
bigent memory add "User prefers concise answers."
bigent memory search preferences
bigent service status
bigent service restart
```

Useful environment:

- `BIGENT_CWD`: working directory Pi should operate in. Defaults to the current directory.
- `BIGENT_HOME`: BIgent state, auth, models, and sessions directory. Defaults to `~/.bigent`.
- `BIGENT_PI_API_PROVIDER`: provider id for `BIGENT_PI_API_KEY`, for example `xiaomi-token-plan-sgp`.
- `BIGENT_PI_API_KEY`: Runtime API key for `BIGENT_PI_API_PROVIDER`.
- `BIGENT_PI_THINKING`: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `BIGENT_LOOP_MAX_TURNS`: upper bound for `bigent loop` and Telegram `/loop`. Defaults to `30`.

## Tools

BIgent enables Pi's common coding tools:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

BIgent adds focused minimal custom tools:

- `web_search`: current web search through Brave Search when `BRAVE_API_KEY` is set, otherwise DuckDuckGo's lightweight HTML endpoint.
- `http_fetch`: fetch and trim public HTTP(S) pages.
- `now`: local and UTC time.
- `workspace_summary`: summarize files, package metadata, and git state for the active workspace.
- `shell_check`: run a short, non-destructive shell command for diagnostics.
- `text_stats`: count characters, words, lines, and rough tokens.
- `weather`: current weather through Open-Meteo.
- `exchange_rate`: currency conversion through Frankfurter/ECB rates.
- `memory_save`, `memory_search`, `memory_list`: durable JSONL memory in `BIGENT_HOME/memories`.
- `subagent`: run a focused one-shot BIgent/Pi subagent for isolated work.

## Persistent Memory and Terminal UIs

BIgent includes two separate terminal interfaces:

```sh
bigent config
bigent chat
```

`bigent config` opens a blessed-powered nmtui-style config editor for `~/.config/bigent/bigent.env`. Environment variables still override file values.

Config TUI keys:

- `↑`/`↓` or `k`/`j`: move selection
- `Enter`: edit selected field
- `Space`: cycle choice fields, for example thinking level
- `d` or `Backspace`: clear selected field
- `s`: save changes to `~/.config/bigent/bigent.env`
- `r`: reload values from the config file
- `q` or `Esc`: quit, warns if there are unsaved changes
- `Ctrl-C` or `Ctrl-D`: quit immediately

`bigent chat` starts a blessed-powered persistent terminal chat session with slash-command prediction, loop mode, tool status lines, and memory commands.

Chat TUI keys:

- `Enter`: send message or slash command
- `Tab`: complete the predicted slash command
- `↑`/`↓`: browse input history
- `PageUp`/`PageDown`: scroll transcript
- `Ctrl-C` or `Ctrl-D`: quit

Commands inside the chat TUI:

- `/help`: show chat TUI commands
- `/new [name]`: start a new terminal chat session
- `/status`: show active config
- `/loop <prompt>`: run loop mode from the terminal
- `/memory add|search|list|delete`: manage persistent memory
- `/exit`: leave the TUI

BIgent automatically extracts durable preferences/project facts from useful conversations, injects relevant memories into future prompts, and still exposes memory commands for inspection or cleanup.

## Telegram Commands

- `/help`: show commands
- `/new [name]`: start a new session
- `/sessions`: list sessions
- `/session use <id>`: switch session
- `/session delete <id>`: delete a session
- `/status`: show active config
- `/loop <prompt>`: run a bounded agentic loop
- `/models [provider]`: list known models
- `/memory add|search|list|delete`: manage persistent memory
- `/thinking [level|clear]`: manage thinking level
- `/apikey status|set|provider|clear`: manage chat API key override
- `/service start|stop|restart|status|logs|enable|disable`: manage user service
- `/stop`: stop the Telegram service

## Updating Pi

Run:

```sh
bigent update
bigent update-pi
bigent update-pi --commit
```

`bigent update` pulls the latest BIgent source from GitHub, updates the Pi SDK packages with `npm install --ignore-scripts`, and rebuilds. `bigent update-pi` only updates `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` with install scripts disabled; with `--commit`, it also commits `package.json` and `package-lock.json`.

## Uninstall

```sh
bigent uninstall
bigent uninstall --purge
```

`bigent uninstall` stops/disables the user service, removes the service file, removes the `bigent` command link, and removes the install directory. `--purge` also removes `~/.config/bigent` and `~/.bigent`.

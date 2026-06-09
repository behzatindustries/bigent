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

BIgent uses Pi's default provider/model selection by default. Choose or change provider/model through Pi itself, or use BIgent's Telegram `/model` commands when you need a chat-specific override.

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
bigent search "latest Pi coding agent"
bigent service status
bigent service restart
```

Useful environment:

- `BIGENT_CWD`: working directory Pi should operate in. Defaults to the current directory.
- `BIGENT_HOME`: BIgent state, auth, models, and sessions directory. Defaults to `~/.bigent`.
- `BIGENT_PI_PROVIDER`: optional Pi provider override. Blank uses Pi default.
- `BIGENT_PI_MODEL`: optional Pi model override. Blank uses Pi default.
- `BIGENT_PI_API_PROVIDER`: provider id for `BIGENT_PI_API_KEY`, for example `xiaomi-token-plan-sgp`.
- `BIGENT_PI_API_KEY`: Runtime API key for `BIGENT_PI_API_PROVIDER`.
- `BIGENT_PI_THINKING`: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.

## Tools

BIgent enables Pi's common coding tools:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

BIgent adds three minimal custom tools:

- `web_search`: current web search through DuckDuckGo's lightweight HTML endpoint.
- `http_fetch`: fetch and trim public HTTP(S) pages.
- `now`: local and UTC time.
- `subagent`: run a focused one-shot BIgent/Pi subagent for isolated work.

## Telegram Commands

- `/help`: show commands
- `/new [name]`: start a new session
- `/sessions`: list sessions
- `/session use <id>`: switch session
- `/session delete <id>`: delete a session
- `/status`: show active config
- `/loop <prompt>`: run a bounded agentic loop
- `/model <provider> <model>`: set model
- `/model clear`: clear model override
- `/models [provider]`: list known models
- `/provider [id|clear]`: manage provider
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

## behzat.org Installer

Upload [scripts/install-bigent.sh](scripts/install-bigent.sh) to:

```text
https://behzat.org/install-bigent.sh
```

The script installs or updates BIgent from the GitHub repo, runs `npm ci --ignore-scripts`, builds the TypeScript package, links `bigent` into `~/.local/bin`, prompts for Telegram/Pi settings, and can install the user systemd service.

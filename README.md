# BIgent

BIgent means **Behzat Industries Agent**. It is a minimal Telegram-first agent built on top of the Pi coding agent SDK.

BIgent does not fork or edit Pi. Pi is an npm dependency, and the `bigent update-pi` command bumps the dependency to the newest SDK release and rebuilds the wrapper.

## Install

From GitHub:

```sh
git clone https://github.com/behzatindustries/bigent.git
cd bigent
npm install
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

## Telegram

Create a Telegram bot with BotFather, then set:

```sh
export TELEGRAM_BOT_TOKEN="..."
export BIGENT_TELEGRAM_ALLOWLIST="123456789"
bigent telegram
```

If `BIGENT_TELEGRAM_ALLOWLIST` is empty, any Telegram chat that can reach the bot can use it.

## CLI

```sh
bigent ask "inspect this repo and summarize the package"
```

Useful environment:

- `BIGENT_CWD`: working directory Pi should operate in. Defaults to the current directory.
- `BIGENT_HOME`: BIgent state, auth, models, and sessions directory. Defaults to `~/.bigent`.

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

## Updating Pi

Run:

```sh
bigent update-pi
bigent update-pi --commit
```

That command installs the latest `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, then builds BIgent. With `--commit`, it also commits `package.json` and `package-lock.json`.

## behzat.org Installer

Upload [scripts/install-bigent.sh](scripts/install-bigent.sh) to:

```text
https://behzat.org/install-bigent.sh
```

The script installs or updates BIgent from the GitHub repo, runs `npm ci`, builds the TypeScript package, and links `bigent` into `~/.local/bin`.

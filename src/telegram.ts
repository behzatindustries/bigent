import fs from "node:fs/promises";
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { BigentAgent } from "./agent.js";
import type { BigentConfig, BigentThinkingLevel } from "./config.js";
import { runLoopedPrompt } from "./loop.js";
import { runServiceAction, serviceLogs } from "./service.js";
import { normalizeSessionId, StateStore, type ChatState } from "./state.js";

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number | string };
  from?: { id: number | string; username?: string };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

export class TelegramBridge {
  private offset = 0;
  private readonly token: string;
  private readonly config: BigentConfig;
  private readonly state: StateStore;

  constructor(config: BigentConfig) {
    if (!config.telegramToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram mode.");
    }
    this.token = config.telegramToken;
    this.config = config;
    this.state = new StateStore(config.homeDir);
  }

  async run(): Promise<void> {
    console.log("BIgent Telegram bridge is running.");
    for (;;) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message?.text) {
            await this.handleMessage(update.message);
          }
        }
      } catch (error) {
        console.error(`Telegram poll error: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(5000);
      }
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const fromId = message.from ? String(message.from.id) : chatId;
    if (!this.isAllowed(chatId, fromId)) {
      await this.sendMessage(chatId, "Unauthorized.");
      return;
    }

    const text = message.text?.trim();
    if (!text || text === "/start" || text === "/help") {
      await this.sendMessage(chatId, HELP_TEXT);
      return;
    }

    if (text.startsWith("/")) {
      await this.handleCommand(chatId, text);
      return;
    }

    await this.sendChatAction(chatId, "typing");
    try {
      const chat = await this.state.getChat(chatId);
      const agent = new BigentAgent({
        homeDir: this.config.homeDir,
        cwd: this.config.cwd,
        sessionScope: this.sessionScope(chatId, chat.activeSession),
        piApiProvider: chat.piApiProvider ?? this.config.piApiProvider,
        piApiKey: chat.piApiKey ?? this.config.piApiKey,
        piThinking: chat.piThinking ?? this.config.piThinking,
      });
      const answer = await agent.prompt(text.replace(/^\/bigent\s*/i, "").trim() || text);
      await this.sendMessage(chatId, answer || "Done.");
    } catch (error) {
      await this.sendMessage(chatId, this.renderError(error));
    }
  }

  private async handleCommand(chatId: string, text: string): Promise<void> {
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = normalizeCommand(rawCommand, args);
    try {
      if (command === "/help" || command === "/commands") {
        await this.sendMessage(chatId, HELP_TEXT);
        return;
      }
      if (command === "/status") {
        await this.sendMessage(chatId, await this.renderStatus(chatId));
        return;
      }
      if (command === "/loop") {
        const prompt = args.join(" ").trim();
        if (!prompt) throw new Error("Usage: /loop <prompt...>");
        await this.sendChatAction(chatId, "typing");
        const progressMessageId = await this.sendProgressMessage(chatId, `Loop started: 0/${this.config.loopMaxTurns}`);
        const chat = await this.state.getChat(chatId);
        const agent = new BigentAgent({
          homeDir: this.config.homeDir,
          cwd: this.config.cwd,
          sessionScope: this.sessionScope(chatId, chat.activeSession),
          piApiProvider: chat.piApiProvider ?? this.config.piApiProvider,
          piApiKey: chat.piApiKey ?? this.config.piApiKey,
          piThinking: chat.piThinking ?? this.config.piThinking,
        });
        const result = await runLoopedPrompt(agent, prompt, {
          maxTurns: this.config.loopMaxTurns,
          onProgress: async (event) => {
            if (event.stage === "before_turn") {
              await this.editMessage(chatId, progressMessageId, `Loop turn ${event.turn}/${event.maxTurns} running...`);
              return;
            }
            if (event.stage === "after_turn") {
              await this.editMessage(chatId, progressMessageId, `Loop turn ${event.turn}/${event.maxTurns}: ${event.status}`);
              return;
            }
            if (event.stage === "blocked") {
              await this.editMessage(chatId, progressMessageId, `Loop blocked at ${event.turn}/${event.maxTurns}`);
              return;
            }
            if (event.stage === "stopped") {
              await this.editMessage(chatId, progressMessageId, `Loop stopped at ${event.turn}/${event.maxTurns}`);
              return;
            }
            if (event.stage === "done") {
              await this.editMessage(chatId, progressMessageId, `Loop done at ${event.turn}/${event.maxTurns}`);
            }
          },
        });
        await this.deleteMessage(chatId, progressMessageId);
        await this.sendMessage(chatId, result.answer || "Done.");
        return;
      }
      if (command === "/new") {
        const sessionId = normalizeSessionId(args.join("-"));
        await this.state.updateChat(chatId, (chat) => {
          chat.activeSession = sessionId;
          chat.sessions.unshift(sessionId);
        });
        await this.sendMessage(chatId, `New session: ${sessionId}`);
        return;
      }
      if (command === "/sessions") {
        await this.sendMessage(chatId, await this.renderSessions(chatId));
        return;
      }
      if (command === "/session") {
        await this.handleSessionCommand(chatId, args);
        return;
      }
      if (command === "/model" || command === "/provider") {
        await this.sendMessage(chatId, "BIgent uses Pi's selected provider/model. Change it with the Pi CLI or Pi login flow.");
        return;
      }
      if (command === "/thinking") {
        await this.handleThinkingCommand(chatId, args[0]);
        return;
      }
      if (command === "/apikey") {
        await this.handleApiKeyCommand(chatId, args);
        return;
      }
      if (command === "/models") {
        await this.sendMessage(chatId, this.renderModels(args[0]));
        return;
      }
      if (command === "/service") {
        await this.handleServiceCommand(chatId, args);
        return;
      }
      if (command === "/stop") {
        await this.sendMessage(chatId, "Stopping BIgent Telegram service.");
        runServiceAction("stop");
        return;
      }
      await this.sendMessage(chatId, `Unknown command: ${rawCommand}\n\n${HELP_TEXT}`);
    } catch (error) {
      await this.sendMessage(chatId, this.renderError(error));
    }
  }

  private async handleSessionCommand(chatId: string, args: string[]): Promise<void> {
    const [action, value] = args;
    if (!action || action === "show") {
      const chat = await this.state.getChat(chatId);
      await this.sendMessage(chatId, `Active session: ${chat.activeSession}`);
      return;
    }
    if (action === "use") {
      const sessionId = normalizeSessionId(value);
      await this.state.updateChat(chatId, (chat) => {
        chat.activeSession = sessionId;
        chat.sessions.unshift(sessionId);
      });
      await this.sendMessage(chatId, `Using session: ${sessionId}`);
      return;
    }
    if (action === "delete") {
      if (!value) throw new Error("Usage: /session delete <id>");
      const sessionId = normalizeSessionId(value);
      await fs.rm(path.join(this.config.homeDir, "sessions", this.sessionScope(chatId, sessionId)), {
        recursive: true,
        force: true,
      });
      await this.state.deleteSession(chatId, sessionId);
      await this.sendMessage(chatId, `Deleted session: ${sessionId}`);
      return;
    }
    throw new Error("Usage: /session show | /session use <id> | /session delete <id>");
  }

  private async handleThinkingCommand(chatId: string, value: string | undefined): Promise<void> {
    if (!value || value === "show") {
      const chat = await this.state.getChat(chatId);
      await this.sendMessage(chatId, `Thinking: ${chat.piThinking ?? this.config.piThinking ?? "Pi default"}`);
      return;
    }
    if (value === "clear") {
      await this.state.updateChat(chatId, (chat) => {
        delete chat.piThinking;
      });
      await this.sendMessage(chatId, "Thinking override cleared.");
      return;
    }
    if (!isThinkingLevel(value)) throw new Error("Use: off, minimal, low, medium, high, xhigh");
    await this.state.updateChat(chatId, (chat) => {
      chat.piThinking = value;
    });
    await this.sendMessage(chatId, `Thinking set: ${value}`);
  }

  private async handleApiKeyCommand(chatId: string, args: string[]): Promise<void> {
    const [action, ...rest] = args;
    if (!action || action === "status") {
      const chat = await this.state.getChat(chatId);
      const provider = chat.piApiProvider ?? this.config.piApiProvider ?? "not set";
      await this.sendMessage(
        chatId,
        `API key: ${chat.piApiKey || this.config.piApiKey ? "configured" : "not configured"}\nAPI provider: ${provider}`,
      );
      return;
    }
    if (action === "clear") {
      await this.state.updateChat(chatId, (chat) => {
        delete chat.piApiProvider;
        delete chat.piApiKey;
      });
      await this.sendMessage(chatId, "API key override cleared.");
      return;
    }
    if (action === "set") {
      const [provider, ...keyParts] = rest;
      const key = keyParts.join(" ").trim();
      if (!provider || !key) throw new Error("Usage: /apikey set <provider> <key>");
      await this.state.updateChat(chatId, (chat) => {
        chat.piApiProvider = provider;
        chat.piApiKey = key;
      });
      await this.sendMessage(
        chatId,
        `API key override saved for provider: ${provider}\nDelete the Telegram message containing the key.`,
      );
      return;
    }
    if (action === "fix") {
      const chat = await this.state.updateChat(chatId, (entry) => {
        if (!entry.piApiProvider && entry.piApiKey) {
          const match = entry.piApiKey.match(/^([a-zA-Z0-9_.-]+)\s+(.+)$/);
          if (match) {
            entry.piApiProvider = match[1];
            entry.piApiKey = match[2];
          }
        }
      });
      await this.sendMessage(
        chatId,
        chat.piApiProvider ? `API key state fixed for provider: ${chat.piApiProvider}` : "No legacy API key state found to fix.",
      );
      return;
    }
    if (action === "provider") {
      const provider = rest[0];
      if (!provider) throw new Error("Usage: /apikey provider <provider>");
      await this.state.updateChat(chatId, (chat) => {
        chat.piApiProvider = provider;
      });
      await this.sendMessage(chatId, `API provider set: ${provider}`);
      return;
    }
    throw new Error("Usage: /apikey status | /apikey set <provider> <key> | /apikey provider <provider> | /apikey fix | /apikey clear");
  }

  private async handleServiceCommand(chatId: string, args: string[]): Promise<void> {
    const action = args[0] ?? "status";
    if (action === "logs") {
      await this.sendMessage(chatId, serviceLogs());
      return;
    }
    if (!["start", "stop", "restart", "status", "enable", "disable"].includes(action)) {
      throw new Error("Usage: /service start|stop|restart|status|logs|enable|disable");
    }
    const output = runServiceAction(action as "start" | "stop" | "restart" | "status" | "enable" | "disable");
    await this.sendMessage(chatId, output);
  }

  private async renderStatus(chatId: string): Promise<string> {
    const chat = await this.state.getChat(chatId);
    return [
      "BIgent status",
      `chat: ${chatId}`,
      `session: ${chat.activeSession}`,
      `cwd: ${this.config.cwd}`,
      `api provider: ${chat.piApiProvider ?? this.config.piApiProvider ?? "not set"}`,
      `thinking: ${chat.piThinking ?? this.config.piThinking ?? "Pi default"}`,
      `api key: ${chat.piApiKey || this.config.piApiKey ? "configured" : "not configured"}`,
    ].join("\n");
  }

  private async renderSessions(chatId: string): Promise<string> {
    const chat = await this.state.getChat(chatId);
    return chat.sessions.map((entry) => `${entry === chat.activeSession ? "*" : "-"} ${entry}`).join("\n");
  }

  private renderModels(provider?: string): string {
    const authStorage = AuthStorage.create(path.join(this.config.homeDir, "auth.json"));
    const registry = ModelRegistry.create(authStorage, path.join(this.config.homeDir, "models.json"));
    const models = registry
      .getAll()
      .filter((model) => !provider || model.provider === provider)
      .slice(0, 80)
      .map((model) => `${model.provider}/${model.id}`);
    return models.length ? models.join("\n") : `No models found${provider ? ` for ${provider}` : ""}.`;
  }

  private sessionScope(chatId: string, sessionId: string): string {
    return `telegram-${chatId}-${sessionId}`;
  }

  private renderError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const provider = message.match(/No API key found for ([^\s.]+)/)?.[1];
    if (!provider) return `Error: ${message}`;
    return [
      `Error: ${message}`,
      "",
      `BIgent needs the API key provider set separately. Try:`,
      `/apikey set ${provider} <your-api-key>`,
      "",
      `Or set these in ~/.config/bigent/bigent.env:`,
      `BIGENT_PI_API_PROVIDER='${provider}'`,
      `BIGENT_PI_API_KEY='<your-api-key>'`,
      "",
      `Then restart: /service restart`,
    ].join("\n");
  }

  private isAllowed(chatId: string, fromId: string): boolean {
    return (
      this.config.telegramAllowlist.size === 0 ||
      this.config.telegramAllowlist.has(chatId) ||
      this.config.telegramAllowlist.has(fromId)
    );
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    return this.retry(() =>
      this.call<TelegramUpdate[]>("getUpdates", {
        timeout: 45,
        offset: this.offset,
        allowed_updates: ["message"],
      }),
    );
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks = chunkText(text, 3900);
    for (const chunk of chunks) {
      await this.call("sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
  }

  private async sendChatAction(chatId: string, action: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  private async sendProgressMessage(chatId: string, text: string): Promise<number> {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }).then((result) => result.message_id);
  }

  private async editMessage(chatId: string, messageId: number, text: string): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
    });
  }

  private async deleteMessage(chatId: string, messageId: number): Promise<void> {
    await this.call("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  private async call<T = unknown>(method: string, body: unknown): Promise<T> {
    return this.retry(async () => {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as TelegramResponse<T>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.description ?? `Telegram API failed: ${response.status}`);
      }
      return payload.result;
    });
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

const HELP_TEXT = `BIgent commands
/help - show commands
/status - show chat config
/loop <prompt> - run bounded agentic loop
/new [name] - start a new session
/sessions - list sessions
/session show - show active session
/session use <id> - switch session
/session delete <id> - delete session files
/models [provider] - list known models
/thinking [level|clear] - show/set/clear thinking
/apikey status - show key status
/apikey set <provider> <key> - save chat key override
/apikey provider <provider> - set key provider
/apikey fix - migrate old provider/key state
/apikey clear - clear chat key override
/service status - user service status
/service start|stop|restart|enable|disable|logs
/stop - stop Telegram service`;

function isThinkingLevel(value: string): value is BigentThinkingLevel {
  return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value);
}

function normalizeCommand(rawCommand: string, args: string[]): string {
  if (rawCommand.toLowerCase() === "/bigent") {
    const nested = args.shift();
    return nested ? `/${nested.replace(/^\//, "").toLowerCase()}` : "/help";
  }
  return rawCommand.toLowerCase();
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  chunks.push(remaining);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

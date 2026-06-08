import { BigentAgent } from "./agent.js";
import type { BigentConfig } from "./config.js";

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

  constructor(config: BigentConfig) {
    if (!config.telegramToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram mode.");
    }
    this.token = config.telegramToken;
    this.config = config;
  }

  async run(): Promise<void> {
    console.log("BIgent Telegram bridge is running.");
    for (;;) {
      const updates = await this.getUpdates();
      for (const update of updates) {
        this.offset = update.update_id + 1;
        if (update.message?.text) {
          await this.handleMessage(update.message);
        }
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
    if (!text || text === "/start") {
      await this.sendMessage(chatId, "BIgent is ready.");
      return;
    }

    await this.sendChatAction(chatId, "typing");
    try {
      const agent = new BigentAgent({
        homeDir: this.config.homeDir,
        cwd: this.config.cwd,
        sessionScope: `telegram-${chatId}`,
        piProvider: this.config.piProvider,
        piModel: this.config.piModel,
        piApiKey: this.config.piApiKey,
        piThinking: this.config.piThinking,
      });
      const answer = await agent.prompt(text.replace(/^\/bigent\s*/i, "").trim() || text);
      await this.sendMessage(chatId, answer || "Done.");
    } catch (error) {
      await this.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isAllowed(chatId: string, fromId: string): boolean {
    return (
      this.config.telegramAllowlist.size === 0 ||
      this.config.telegramAllowlist.has(chatId) ||
      this.config.telegramAllowlist.has(fromId)
    );
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const response = await this.call<TelegramUpdate[]>("getUpdates", {
      timeout: 45,
      offset: this.offset,
      allowed_updates: ["message"],
    });
    return response;
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

  private async call<T = unknown>(method: string, body: unknown): Promise<T> {
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
  }
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

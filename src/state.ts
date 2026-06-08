import fs from "node:fs/promises";
import path from "node:path";
import type { BigentThinkingLevel } from "./config.js";

export type ChatState = {
  activeSession: string;
  sessions: string[];
  piProvider?: string;
  piModel?: string;
  piApiKey?: string;
  piThinking?: BigentThinkingLevel;
};

export type BigentState = {
  chats: Record<string, ChatState>;
};

const DEFAULT_STATE: BigentState = { chats: {} };

export class StateStore {
  private readonly path: string;

  constructor(homeDir: string) {
    this.path = path.join(homeDir, "state.json");
  }

  async getChat(chatId: string): Promise<ChatState> {
    const state = await this.read();
    return this.ensureChat(state, chatId);
  }

  async updateChat(chatId: string, update: (chat: ChatState) => void): Promise<ChatState> {
    const state = await this.read();
    const chat = this.ensureChat(state, chatId);
    update(chat);
    chat.sessions = [...new Set(chat.sessions)];
    await this.write(state);
    return chat;
  }

  async deleteSession(chatId: string, sessionId: string): Promise<ChatState> {
    return this.updateChat(chatId, (chat) => {
      chat.sessions = chat.sessions.filter((entry) => entry !== sessionId);
      if (chat.activeSession === sessionId) {
        chat.activeSession = chat.sessions[0] ?? "default";
      }
      if (!chat.sessions.includes(chat.activeSession)) {
        chat.sessions.unshift(chat.activeSession);
      }
    });
  }

  private ensureChat(state: BigentState, chatId: string): ChatState {
    state.chats[chatId] ??= { activeSession: "default", sessions: ["default"] };
    return state.chats[chatId];
  }

  private async read(): Promise<BigentState> {
    try {
      const raw = await fs.readFile(this.path, "utf8");
      return JSON.parse(raw) as BigentState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(DEFAULT_STATE);
      }
      throw error;
    }
  }

  private async write(state: BigentState): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }
}

export function normalizeSessionId(value: string | undefined): string {
  const normalized = value?.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48);
  return normalized || `session-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

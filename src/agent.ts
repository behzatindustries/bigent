import fs from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { BIGENT_SYSTEM_PROMPT } from "./prompt.js";
import { commonTools } from "./tools.js";

type AgentEvent = {
  type?: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

export type BigentAgentOptions = {
  homeDir: string;
  cwd: string;
  sessionScope?: string;
};

export class BigentAgent {
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly sessionScope: string;

  constructor(options: BigentAgentOptions) {
    this.homeDir = options.homeDir;
    this.cwd = options.cwd;
    this.sessionScope = options.sessionScope ?? "cli";
  }

  async prompt(text: string): Promise<string> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const authPath = path.join(this.homeDir, "auth.json");
    const modelsPath = path.join(this.homeDir, "models.json");
    const sessionDir = path.join(this.homeDir, "sessions", this.sessionScope);
    await fs.mkdir(sessionDir, { recursive: true });

    const authStorage = AuthStorage.create(authPath);
    const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
    const loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.homeDir,
      systemPromptOverride: () => BIGENT_SYSTEM_PROMPT,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: this.cwd,
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager: SessionManager.create(sessionDir),
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search", "http_fetch", "now"],
      customTools: commonTools,
    });

    let output = "";
    const unsubscribe = session.subscribe((event: AgentEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        output += event.assistantMessageEvent.delta ?? "";
      }
    });

    try {
      await session.prompt(text);
    } finally {
      unsubscribe();
    }

    return output.trim();
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type, type Api, type Model } from "@earendil-works/pi-ai";
import type { BigentThinkingLevel } from "./config.js";
import { BIGENT_SYSTEM_PROMPT } from "./prompt.js";
import { commonTools } from "./tools.js";

type AgentEvent = {
  type?: string;
  message?: unknown;
  messages?: unknown[];
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

export type BigentAgentOptions = {
  homeDir: string;
  cwd: string;
  sessionScope?: string;
  piProvider?: string;
  piModel?: string;
  piApiProvider?: string;
  piApiKey?: string;
  piThinking?: BigentThinkingLevel;
  allowSubagents?: boolean;
};

export class BigentAgent {
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly sessionScope: string;
  private readonly piProvider?: string;
  private readonly piModel?: string;
  private readonly piApiProvider?: string;
  private readonly piApiKey?: string;
  private readonly piThinking?: BigentThinkingLevel;
  private readonly allowSubagents: boolean;

  constructor(options: BigentAgentOptions) {
    this.homeDir = options.homeDir;
    this.cwd = options.cwd;
    this.sessionScope = options.sessionScope ?? "cli";
    this.piProvider = options.piProvider;
    this.piModel = options.piModel;
    this.piApiProvider = options.piApiProvider;
    this.piApiKey = options.piApiKey;
    this.piThinking = options.piThinking;
    this.allowSubagents = options.allowSubagents ?? true;
  }

  async prompt(text: string): Promise<string> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const authPath = path.join(this.homeDir, "auth.json");
    const modelsPath = path.join(this.homeDir, "models.json");
    const sessionDir = path.join(this.homeDir, "sessions", this.sessionScope);
    await fs.mkdir(sessionDir, { recursive: true });

    const authStorage = AuthStorage.create(authPath);
    const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
    const { provider: apiProvider, key: apiKey } = this.resolveApiCredential();
    if (apiProvider && apiKey) {
      authStorage.setRuntimeApiKey(apiProvider, apiKey);
    }
    const model = this.resolveConfiguredModel(modelRegistry);
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
      model,
      thinkingLevel: this.piThinking,
      resourceLoader: loader,
      sessionManager: SessionManager.create(sessionDir),
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search", "http_fetch", "now", "subagent"],
      customTools: this.allowSubagents ? [...commonTools, this.createSubagentTool()] : commonTools,
    });

    let output = "";
    const unsubscribe = session.subscribe((event: AgentEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        output += event.assistantMessageEvent.delta ?? "";
      }
      if (event.type === "message_end") {
        const finalText = extractAssistantText(event.message);
        if (finalText) output = finalText;
      }
      if (event.type === "agent_end" && event.messages) {
        const finalText = extractLastAssistantText(event.messages);
        if (finalText) output = finalText;
      }
    });

    try {
      await session.prompt(text);
    } finally {
      unsubscribe();
    }

    return output.trim();
  }

  private resolveConfiguredModel(modelRegistry: ModelRegistry): Model<Api> | undefined {
    if (!this.piProvider && !this.piModel) return undefined;
    if (!this.piProvider || !this.piModel) {
      throw new Error("Both BIGENT_PI_PROVIDER and BIGENT_PI_MODEL are required when either is set.");
    }

    const model = modelRegistry.find(this.piProvider, this.piModel);
    if (!model) {
      throw new Error(`Unknown Pi model: ${this.piProvider}/${this.piModel}`);
    }
    return model;
  }

  private resolveApiCredential(): { provider?: string; key?: string } {
    const fallbackProvider = this.piApiProvider ?? this.piProvider;
    if (!this.piApiKey) return { provider: fallbackProvider };

    const legacyMatch = this.piApiKey.match(/^([a-zA-Z0-9_.-]+)\s+(.+)$/);
    if (legacyMatch) {
      return { provider: legacyMatch[1], key: legacyMatch[2] };
    }
    if (fallbackProvider) return { provider: fallbackProvider, key: this.piApiKey };
    return { key: this.piApiKey };
  }

  private createSubagentTool() {
    return defineTool({
      name: "subagent",
      label: "Subagent",
      description: "Run a focused one-shot BIgent/Pi subagent for an isolated task and return its answer.",
      parameters: Type.Object({
        task: Type.String({ description: "The exact task for the subagent." }),
        scope: Type.Optional(Type.String({ description: "Short label for the subagent session." })),
      }),
      execute: async (_toolCallId, params) => {
        const scope = (params.scope ?? "task").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48);
        const subagent = new BigentAgent({
          homeDir: this.homeDir,
          cwd: this.cwd,
          sessionScope: `subagent-${scope}-${Date.now()}`,
          piProvider: this.piProvider,
          piModel: this.piModel,
          piApiProvider: this.piApiProvider,
          piApiKey: this.piApiKey,
          piThinking: this.piThinking,
          allowSubagents: false,
        });
        const answer = await subagent.prompt(params.task);
        return {
          content: [{ type: "text", text: answer || "Subagent completed without text output." }],
          details: { scope },
        };
      },
    });
  }
}

function extractLastAssistantText(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    const text = extractAssistantText(message);
    if (text) return text;
  }
  return "";
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const candidate = message as { role?: string; content?: unknown; errorMessage?: string };
  if (candidate.role !== "assistant") return "";
  const text = extractText(candidate.content);
  return text || candidate.errorMessage || "";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: string; text?: string };
      return candidate.type === "text" && candidate.text ? candidate.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

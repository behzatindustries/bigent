import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const USER_AGENT = "BIgent/0.1 (+https://github.com/behzatindustries/bigent)";
const execFileAsync = promisify(execFile);

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description: "Search the web for current information using DuckDuckGo's lightweight HTML endpoint.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 8, description: "Maximum result count" })),
  }),
  execute: async (_toolCallId, params) => {
    const maxResults = normalizeMax(params.maxResults, 5, 1, 8);
    const matches = await webSearch(params.query, maxResults);

    return {
      content: [{ type: "text", text: matches.length ? matches.join("\n\n") : "No results found." }],
      details: { query: params.query, maxResults },
    };
  },
});

export async function webSearch(query: string, maxResults = 5): Promise<string[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`Search failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  return [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs)]
    .slice(0, maxResults)
    .map((match, index) => {
      const resultUrl = new URL(match[1], "https://duckduckgo.com").searchParams.get("uddg") ?? match[1];
      return `${index + 1}. ${stripHtml(match[2])}\n${resultUrl}`;
    });
}

export const httpFetchTool = defineTool({
  name: "http_fetch",
  label: "HTTP Fetch",
  description: "Fetch a public HTTP(S) URL and return plain text trimmed to a safe size.",
  parameters: Type.Object({
    url: Type.String({ description: "HTTP or HTTPS URL" }),
    maxChars: Type.Optional(Type.Number({ minimum: 200, maximum: 12000, description: "Maximum characters to return" })),
  }),
  execute: async (_toolCallId, params) => {
    const url = new URL(params.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only http and https URLs are supported.");
    }

    const maxChars = normalizeMax(params.maxChars, 4000, 200, 12000);
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,text/plain,application/json",
      },
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("text/html") ? stripHtml(text) : text.replace(/\s+/g, " ").trim();

    return {
      content: [{ type: "text", text: body.slice(0, maxChars) }],
      details: { status: response.status, contentType, truncated: body.length > maxChars },
    };
  },
});

export const nowTool = defineTool({
  name: "now",
  label: "Current Time",
  description: "Return the current local and UTC time.",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [
      {
        type: "text",
        text: `Local: ${new Date().toString()}\nUTC: ${new Date().toISOString()}`,
      },
    ],
    details: {},
  }),
});

export const workspaceSummaryTool = defineTool({
  name: "workspace_summary",
  label: "Workspace Summary",
  description: "Summarize the current workspace files, package metadata, and git state.",
  parameters: Type.Object({
    root: Type.Optional(Type.String({ description: "Workspace root. Defaults to the current working directory." })),
  }),
  execute: async (_toolCallId, params) => {
    const root = path.resolve(params.root ?? process.cwd());
    const [files, packageJson, gitStatus] = await Promise.all([
      listFiles(root, 80),
      readOptional(path.join(root, "package.json")),
      runOptional("git", ["-C", root, "status", "--short", "--branch"]),
    ]);
    const packageInfo = packageJson ? parsePackageSummary(packageJson) : "No package.json found.";

    return {
      content: [
        {
          type: "text",
          text: [`Root: ${root}`, packageInfo, `Git:\n${gitStatus || "Not a git repository or git unavailable."}`, `Files:\n${files.join("\n")}`].join("\n\n"),
        },
      ],
      details: { root, fileCount: files.length },
    };
  },
});

export const shellCheckTool = defineTool({
  name: "shell_check",
  label: "Shell Check",
  description: "Run a read-only shell command with a short timeout and return stdout/stderr.",
  parameters: Type.Object({
    command: Type.String({ description: "Executable name, for example npm or git." }),
    args: Type.Optional(Type.Array(Type.String(), { description: "Command arguments." })),
    cwd: Type.Optional(Type.String({ description: "Working directory." })),
  }),
  execute: async (_toolCallId, params) => {
    const command = params.command.trim();
    if (!command || command.includes("/") || command.includes("\\")) {
      throw new Error("Use an executable name only.");
    }
    if (isBlockedShellCommand(command)) {
      throw new Error(`${command} is not allowed through shell_check.`);
    }
    const cwd = path.resolve(params.cwd ?? process.cwd());
    const args = params.args ?? [];
    const result = await runOptional(command, args, cwd, 15000);

    return {
      content: [{ type: "text", text: result || "Command completed without output." }],
      details: { command, args, cwd },
    };
  },
});

export const textStatsTool = defineTool({
  name: "text_stats",
  label: "Text Stats",
  description: "Count characters, words, lines, and rough tokens for supplied text.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to analyze." }),
  }),
  execute: async (_toolCallId, params) => {
    const lines = params.text ? params.text.split(/\r?\n/).length : 0;
    const words = params.text.trim() ? params.text.trim().split(/\s+/).length : 0;
    const chars = params.text.length;
    const roughTokens = Math.ceil(chars / 4);

    return {
      content: [{ type: "text", text: `Characters: ${chars}\nWords: ${words}\nLines: ${lines}\nRough tokens: ${roughTokens}` }],
      details: { chars, words, lines, roughTokens },
    };
  },
});

export const commonTools = [webSearchTool, httpFetchTool, nowTool, workspaceSummaryTool, shellCheckTool, textStatsTool];

function normalizeMax(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value ?? fallback)));
}

async function listFiles(root: string, maxFiles: number): Promise<string[]> {
  const ignored = new Set([".git", "node_modules", "dist", ".cache"]);
  const files: string[] = [];

  async function visit(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles || ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(root, fullPath) || ".";
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await visit(root);
  return files;
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function runOptional(command: string, args: string[], cwd = process.cwd(), timeout = 8000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer: 64 * 1024,
      env: { ...process.env, HOME: process.env.HOME ?? os.homedir() },
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    return `${candidate.stdout ?? ""}${candidate.stderr ?? ""}`.trim() || candidate.message || "";
  }
}

function parsePackageSummary(value: string): string {
  try {
    const parsed = JSON.parse(value) as { name?: string; version?: string; scripts?: Record<string, string> };
    const scripts = parsed.scripts ? Object.keys(parsed.scripts).join(", ") : "none";
    return `Package: ${parsed.name ?? "unnamed"} ${parsed.version ?? ""}\nScripts: ${scripts}`;
  } catch {
    return "package.json exists but could not be parsed.";
  }
}

function isBlockedShellCommand(command: string): boolean {
  return new Set(["rm", "mv", "cp", "dd", "mkfs", "shutdown", "reboot", "systemctl", "sudo", "ssh", "scp", "rsync"]).has(command);
}

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { MemoryStore, renderMemories } from "./memory.js";

const USER_AGENT = "BIgent/0.1 (+https://github.com/behzatindustries/bigent)";
const execFileAsync = promisify(execFile);

export type CommonToolOptions = {
  homeDir: string;
};

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
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
  description: "Search the web for current information. Uses Brave Search when BRAVE_API_KEY is set, otherwise DuckDuckGo HTML.",
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
  if (process.env.BRAVE_API_KEY) return braveSearch(query, maxResults);
  return duckDuckGoSearch(query, maxResults);
}

async function braveSearch(query: string, maxResults: number): Promise<string[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json",
      "x-subscription-token": process.env.BRAVE_API_KEY ?? "",
    },
  });
  if (!response.ok) throw new Error(`Brave search failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (payload.web?.results ?? []).slice(0, maxResults).map((result, index) => {
    return `${index + 1}. ${stripHtml(result.title ?? "Untitled")}\n${result.url ?? ""}${result.description ? `\n${stripHtml(result.description)}` : ""}`;
  });
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<string[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`);

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
    maxChars: Type.Optional(Type.Number({ minimum: 200, maximum: 20000, description: "Maximum characters to return" })),
  }),
  execute: async (_toolCallId, params) => {
    const url = new URL(params.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are supported.");

    const maxChars = normalizeMax(params.maxChars, 6000, 200, 20000);
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json,application/xml" },
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
    content: [{ type: "text", text: `Local: ${new Date().toString()}\nUTC: ${new Date().toISOString()}` }],
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
    if (!command || command.includes("/") || command.includes("\\")) throw new Error("Use an executable name only.");
    if (isBlockedShellCommand(command)) throw new Error(`${command} is not allowed through shell_check.`);
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
  parameters: Type.Object({ text: Type.String({ description: "Text to analyze." }) }),
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

export const weatherTool = defineTool({
  name: "weather",
  label: "Weather",
  description: "Get current real-world weather for a place using Open-Meteo public APIs.",
  parameters: Type.Object({ location: Type.String({ description: "City or place name" }) }),
  execute: async (_toolCallId, params) => {
    const geo = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geo.searchParams.set("name", params.location);
    geo.searchParams.set("count", "1");
    geo.searchParams.set("language", "en");
    geo.searchParams.set("format", "json");
    const geoResponse = await fetch(geo, { headers: { "user-agent": USER_AGENT } });
    const geoPayload = (await geoResponse.json()) as { results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> };
    const place = geoPayload.results?.[0];
    if (!place) throw new Error(`Location not found: ${params.location}`);

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    const payload = (await response.json()) as { current?: Record<string, number | string> };
    return {
      content: [
        {
          type: "text",
          text: `${place.name}${place.country ? `, ${place.country}` : ""}\nTemp: ${payload.current?.temperature_2m}°C (feels ${payload.current?.apparent_temperature}°C)\nHumidity: ${payload.current?.relative_humidity_2m}%\nWind: ${payload.current?.wind_speed_10m} km/h\nPrecipitation: ${payload.current?.precipitation} mm\nWeather code: ${payload.current?.weather_code}`,
        },
      ],
      details: { place, current: payload.current },
    };
  },
});

export const exchangeRateTool = defineTool({
  name: "exchange_rate",
  label: "Exchange Rate",
  description: "Convert currencies using recent European Central Bank reference rates through Frankfurter.app.",
  parameters: Type.Object({
    amount: Type.Optional(Type.Number({ minimum: 0, description: "Amount to convert" })),
    from: Type.String({ description: "Source currency code, e.g. USD" }),
    to: Type.String({ description: "Target currency code, e.g. EUR" }),
  }),
  execute: async (_toolCallId, params) => {
    const amount = normalizeMax(params.amount, 1, 0, 1_000_000_000);
    const from = params.from.toUpperCase();
    const to = params.to.toUpperCase();
    const url = new URL("https://api.frankfurter.app/latest");
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Exchange rate failed with HTTP ${response.status}`);
    const payload = (await response.json()) as { date?: string; rates?: Record<string, number> };
    return {
      content: [{ type: "text", text: `${amount} ${from} = ${payload.rates?.[to]} ${to} (${payload.date})` }],
      details: payload,
    };
  },
});

export function createMemoryTools(homeDir: string) {
  const memory = new MemoryStore(homeDir);
  return [
    defineTool({
      name: "memory_save",
      label: "Save Memory",
      description: "Persist a durable memory about the user, project, preference, or reusable lesson.",
      parameters: Type.Object({
        text: Type.String({ description: "Memory text to save" }),
        kind: Type.Optional(Type.String({ description: "fact, preference, project, skill, or note" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Short search tags" })),
      }),
      execute: async (_toolCallId, params) => {
        const entry = await memory.add(params.text, { kind: params.kind, tags: params.tags, source: "agent" });
        return { content: [{ type: "text", text: `Saved memory ${entry.id}` }], details: entry };
      },
    }),
    defineTool({
      name: "memory_search",
      label: "Search Memory",
      description: "Search durable BIgent memories across sessions.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_toolCallId, params) => {
        const entries = await memory.search(params.query, normalizeMax(params.maxResults, 8, 1, 20));
        return { content: [{ type: "text", text: renderMemories(entries) }], details: { count: entries.length } };
      },
    }),
    defineTool({
      name: "memory_list",
      label: "List Memories",
      description: "List recent durable BIgent memories.",
      parameters: Type.Object({ maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })) }),
      execute: async (_toolCallId, params) => {
        const entries = await memory.list(normalizeMax(params.maxResults, 12, 1, 50));
        return { content: [{ type: "text", text: renderMemories(entries) }], details: { count: entries.length } };
      },
    }),
  ];
}

export function createCommonTools(options: CommonToolOptions) {
  return [
    webSearchTool,
    httpFetchTool,
    nowTool,
    workspaceSummaryTool,
    shellCheckTool,
    textStatsTool,
    weatherTool,
    exchangeRateTool,
    ...createMemoryTools(options.homeDir),
  ];
}

export const commonTools = [webSearchTool, httpFetchTool, nowTool, workspaceSummaryTool, shellCheckTool, textStatsTool, weatherTool, exchangeRateTool];

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
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(relative);
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

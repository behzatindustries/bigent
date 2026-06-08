import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const USER_AGENT = "BIgent/0.1 (+https://github.com/behzat-industries/bigent)";

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
    const maxResults = Math.max(1, Math.min(8, Number(params.maxResults ?? 5)));
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", params.query);

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
    const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs)]
      .slice(0, maxResults)
      .map((match, index) => {
        const resultUrl = new URL(match[1], "https://duckduckgo.com").searchParams.get("uddg") ?? match[1];
        return `${index + 1}. ${stripHtml(match[2])}\n${resultUrl}`;
      });

    return {
      content: [{ type: "text", text: matches.length ? matches.join("\n\n") : "No results found." }],
      details: { query: params.query, maxResults },
    };
  },
});

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

    const maxChars = Math.max(200, Math.min(12000, Number(params.maxChars ?? 4000)));
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

export const commonTools = [webSearchTool, httpFetchTool, nowTool];

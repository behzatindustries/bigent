import fs from "node:fs/promises";
import path from "node:path";

export type MemoryKind = "fact" | "preference" | "project" | "skill" | "note";

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  source?: string;
};

const MEMORY_KINDS = new Set<MemoryKind>(["fact", "preference", "project", "skill", "note"]);

export class MemoryStore {
  private readonly path: string;

  constructor(homeDir: string) {
    this.path = path.join(homeDir, "memories", "memory.jsonl");
  }

  async add(text: string, options: { kind?: string; tags?: string[]; source?: string } = {}): Promise<MemoryEntry> {
    const normalized = text.trim();
    if (!normalized) throw new Error("Memory text is required.");
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      kind: normalizeKind(options.kind),
      text: normalized,
      tags: normalizeTags(options.tags),
      createdAt: now,
      updatedAt: now,
      source: options.source,
    };
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.appendFile(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }

  async list(limit = 20): Promise<MemoryEntry[]> {
    const entries = await this.readAll();
    return entries.slice(-normalizeLimit(limit, 1, 100)).reverse();
  }

  async search(query: string, limit = 8): Promise<MemoryEntry[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const entries = await this.readAll();
    if (!terms.length) return entries.slice(-normalizeLimit(limit, 1, 50)).reverse();

    return entries
      .map((entry) => ({ entry, score: scoreMemory(entry, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, normalizeLimit(limit, 1, 50))
      .map((item) => item.entry);
  }

  async delete(id: string): Promise<boolean> {
    const entries = await this.readAll();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return false;
    await this.writeAll(next);
    return true;
  }

  async context(query: string, limit = 8): Promise<string> {
    const entries = await this.search(query, limit);
    if (!entries.length) return "";
    return [
      "Relevant persistent BIgent memories:",
      ...entries.map((entry) => `- [${entry.kind}${entry.tags.length ? `:${entry.tags.join(",")}` : ""}] ${entry.text}`),
    ].join("\n");
  }

  private async readAll(): Promise<MemoryEntry[]> {
    try {
      const raw = await fs.readFile(this.path, "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemoryEntry)
        .filter((entry) => entry.id && entry.text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(entries: MemoryEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), {
      mode: 0o600,
    });
  }
}

export function renderMemories(entries: MemoryEntry[]): string {
  return entries.length
    ? entries.map((entry) => `${entry.id} [${entry.kind}] ${entry.text}${entry.tags.length ? ` #${entry.tags.join(" #")}` : ""}`).join("\n")
    : "No memories found.";
}

function normalizeKind(value: string | undefined): MemoryKind {
  const kind = (value ?? "note").trim().toLowerCase() as MemoryKind;
  return MEMORY_KINDS.has(kind) ? kind : "note";
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-")).filter(Boolean))].slice(0, 12);
}

function normalizeLimit(value: unknown, min: number, max: number): number {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.floor(parsed) : min));
}

function scoreMemory(entry: MemoryEntry, terms: string[]): number {
  const haystack = `${entry.kind} ${entry.tags.join(" ")} ${entry.text}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? term.length : 0), 0);
}

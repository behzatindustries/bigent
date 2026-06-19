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

  async rememberConversation(userText: string, assistantText: string, source = "auto"): Promise<MemoryEntry[]> {
    const candidates = extractMemoryCandidates(userText, assistantText);
    const saved: MemoryEntry[] = [];
    for (const candidate of candidates) {
      const entry = await this.addIfNew(candidate.text, { kind: candidate.kind, tags: candidate.tags, source });
      if (entry) saved.push(entry);
    }
    return saved;
  }

  async addIfNew(text: string, options: { kind?: string; tags?: string[]; source?: string } = {}): Promise<MemoryEntry | undefined> {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;
    const entries = await this.readAll();
    const key = normalizeMemoryText(normalized);
    if (entries.some((entry) => normalizeMemoryText(entry.text) === key)) return undefined;
    return this.add(normalized, options);
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

type MemoryCandidate = { text: string; kind: MemoryKind; tags: string[] };

function extractMemoryCandidates(userText: string, assistantText: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const user = userText.trim();
  const assistant = assistantText.trim();
  const lower = user.toLowerCase();

  const explicit = user.match(/(?:remember|save this|note that)[:\s]+(.{8,240})/i)?.[1];
  if (explicit) candidates.push({ text: explicit, kind: "note", tags: ["explicit"] });

  for (const match of user.matchAll(/\b(?:i prefer|i like|i want|please always|always|don't|do not)\b[^.!?\n]{4,180}/gi)) {
    candidates.push({ text: match[0], kind: "preference", tags: ["user"] });
  }

  for (const match of user.matchAll(/\bmy\s+([a-z][a-z0-9 _-]{1,32})\s+(?:is|are)\s+([^\n]{2,120})/gi)) {
    const value = cleanMemoryFragment(match[2]);
    candidates.push({ text: `User's ${match[1].trim()} is ${value}`, kind: "fact", tags: ["user"] });
  }

  for (const match of user.matchAll(/\b(?:i am|i'm|i work on|i use|we use|this project uses|bigent uses)\b[^.!?\n]{4,180}/gi)) {
    const text = match[0];
    candidates.push({ text, kind: /project|bigent|we use|this project/i.test(text) ? "project" : "fact", tags: ["auto"] });
  }

  if (/\bbigent\b/i.test(user) && /\b(?:implemented|added|changed|fixed|installed|deployed|restarted|built)\b/i.test(assistant)) {
    const summary = firstSentence(assistant);
    if (summary) candidates.push({ text: `BIgent project update: ${summary}`, kind: "project", tags: ["bigent"] });
  }

  return dedupeCandidates(candidates).slice(0, 6);
}

function firstSentence(value: string): string {
  return value
    .replace(/\[\[[^\]]+\]\]/g, "")
    .split(/\n|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 12 && part.length <= 220) ?? "";
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen: string[] = [];
  return candidates
    .map((candidate) => ({ ...candidate, text: cleanMemoryFragment(candidate.text) }))
    .sort((a, b) => b.text.length - a.text.length)
    .filter((candidate) => {
      const key = normalizeMemoryText(candidate.text);
      if (!key || seen.some((entry) => entry === key || entry.includes(key) || key.includes(entry))) return false;
      seen.push(key);
      return true;
    });
}

function cleanMemoryFragment(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

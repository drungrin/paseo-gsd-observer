import { isWordAlternative } from "../shared/context.js";
import { ipv6, isReferenceList, ValidationTextSchema } from "../shared/validation.js";
import { safeText } from "./safe-prose.js";

/** Shared reading of GSD Markdown documents for display: bounded sections, tables, frontmatter and privacy-filtered excerpts. */
export type Section = { heading: string | null; lines: string[] };
export type Table = { header: string[]; rows: string[][] };

const maxLineLength = 16_384;
const maxStatusCharacters = 4_096;
export const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/\*\*|__|`/g, "").trim().toLowerCase();

/** Strict UTF-8 text with the BOM removed and LF line endings, or null. */
export function decodeDocument(bytes: Uint8Array): string | null {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); }
  catch { return null; }
}

// Dotted names (underscores included), localhost, ports and "@" all read as hosts, files or accounts.
const hostLike = /[\w-]\.[a-z_]|\blocalhost\b|[a-z]:\d{2,5}\b|@/i;
const ipv4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const abbreviation = /^(?:e\.g|i\.e)$/i;
const flagToken = /^--?[a-z][\w-]*(?:=.*)?$/i;
const tools = "npm|pnpm|npx|yarn|bun|dotnet|cargo|docker|kubectl|helm|psql|pytest|uvx?|turbo|rake|rspec|pipx?|poetry|gradle|mvn|deno|terraform|terragrunt|gh|git|go|mix|bundle|make|node|python3?";
const subcommands = "run|test|exec|install|add|build|compose|up|apply|get|init|plan|push|pull|commit|checkout|status|diff|log|clone|fetch|merge|rebase|reset|start|serve|dev|lint|format|migrate|restore|publish|watch|vet|mod|cp|ps|logs|stop|rm|vitest|jest|playwright|tsc|eslint|prettier|vite|prisma|drizzle-kit";
// Script runners and cloud CLIs take any lowercase subcommand ("npx playwright", "az aks").
const runners = "npx|pnpx|bunx|uvx|pipx|az|aws|gcloud|oci";
// A lowercase tool name followed by a flag or a subcommand starts a command written as prose; its next few arguments go with it.
const toolCommand = new RegExp(`(?<![\\w-])(?:(?:${tools})\\s+(?:--?[a-z][\\w-]*|(?:${subcommands})\\b)|(?:${runners})\\s+[a-z][\\w-]*)(?:\\s+(?:--?[\\w-]+(?:=\\S*)?|[a-z][\\w:.@-]*|\\[omitted\\])){0,4}`, "g");

/** Inline code is shown only as a plain identifier, reference or "key: value" pair; anything else may be a command or location. */
function codeSpan(content: string): string {
  const trimmed = content.trim();
  const tag = /^<\/?([a-z][\w-]*)>$/i.exec(trimmed);
  if (tag) return tag[1];
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(trimmed) || isReferenceList(trimmed) || /^[a-z][\w-]*:\s?[\w-]+$/i.test(trimmed) ? trimmed : "[omitted]";
}

function redactToken(token: string): string {
  if (token === "/" || isReferenceList(token) || isWordAlternative(token)) return token;
  const [, lead, core, trail] = /^([("“'‘*_]*)(.*?)([)"”'’,.;:!?*_]*)$/.exec(token) ?? ["", "", token, ""];
  if (abbreviation.test(core)) return token;
  return /[\\/=]/.test(core) || flagToken.test(core) || hostLike.test(core) || ipv4.test(core) || ipv6.test(core) ? `${lead}[omitted]${trail}` : token;
}

/** Display prose after removing location-like, host-like and command-like tokens; reject what is still unsafe. */
export function excerpt(value: string | null | undefined, max: number): string | null {
  // Oversized input cannot become a valid excerpt; reject it before any token scan.
  if (!value || value.length > max * 4 + 256) return null;
  const redacted = value.replace(/⁄/g, "[omitted]").replace(/`([^`\n]*)`/g, (_, content: string) => codeSpan(content))
    .replace(toolCommand, "[omitted]").replace(/\S+/g, redactToken).replace(/\[omitted\](?:[\s,;]+\[omitted\])+/g, "[omitted]");
  // Surviving slashes belong to identifiers or word alternatives; mask them so the prose checks do not read them as locations.
  const text = safeText(redacted.replace(/\//g, "⁄"), max)?.replace(/⁄/g, "/");
  return text && text.length <= max && ValidationTextSchema(max).safeParse(text).success ? text : null;
}

/** Long prose falls back to its first sentence; the caller marks the excerpt as shortened. */
export function leadExcerpt(value: string, max: number): { text: string | null; shortened: boolean } {
  const full = excerpt(value, max);
  if (full) return { text: full, shortened: false };
  const sentence = /^.+?[.;](?=\s|$)/.exec(value.trim())?.[0];
  return { text: sentence && sentence !== value.trim() ? excerpt(sentence, max) : null, shortened: true };
}

const hexDigest = /(?<![0-9a-f])[0-9a-f]{32,128}(?![0-9a-f])/gi;
const uuid = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

/** Excerpts, never raw Markdown: hash-like values, UUIDs and slash tokens are masked even when embedded in otherwise safe prose. */
export function maskedExcerpt(value: string | null | undefined, max: number): { text: string | null; limited: boolean } {
  if (value === null || value === undefined || !value.trim()) return { text: null, limited: false };
  const safe = value.replace(hexDigest, "[omitted]").replace(uuid, "[omitted]")
    .replace(/\S+/g, (token) => token.includes("/") && !isReferenceList(token) ? "[omitted]" : token);
  const result = leadExcerpt(safe, max);
  return { text: result.text, limited: result.shortened || safe !== value };
}

// Negation may sit up to two words before the pass word ("not really a pass"), including contractions ("didn't pass").
const negatedPassing = /(?:\b(?:not|no|nao|sem|never|nunca|nem)|n['’]t)\s+(?:[\w'’]+\s+){0,2}(?:green|pass\w*|ok|verde|covered|aprovad[oa]|complete\w*|resolved|resolvid[oa]|confirmed|confirmad[oa]|done)\b/;
const noFailures = /\b(?:0|zero|no|sem|nenhum[a]?)\s+(?:fail\w*|falha\w*|red|errors?|erros?|issues?|problem\w*|problemas?|skip\w*|pend\w*|blocked|bloquead\w*|warnings?|avisos?)\b/g;
const marks = /[✅✔❌✖⬜⏳⏭⚠️️]/gu;
export type StatusVocabulary<K extends string> = { words: readonly (readonly [K, RegExp])[]; marks: readonly (readonly [K, RegExp])[]; passing: K; failing: K; other: K };
export type RecordedStatus<K extends string> = { kind: K; label: string | null; note: string | null };

/** Status wording with "0 failed"-style phrases removed, for vocabulary matching. */
export const statusWords = (value: string) => normalize(value).replace(noFailures, " ");
/** A pass word under negation ("didn't pass", "not green"), which is never a pass. */
export const isNegatedPass = (value: string) => negatedPassing.test(statusWords(value));

/** The leading status phrase and the qualifier after it ("✓ WIRED (mecanicamente), ✗ SEM PISO" → "✓ WIRED" + the rest). */
export function statusParts(value: string): { lead: string; rest: string } | null {
  const parts = splitStatus(value);
  return parts && { lead: parts.lead, rest: parts.rest };
}

function splitStatus(value: string): { cell: string; lead: string; rest: string } | null {
  if (value.length > maxStatusCharacters) return null;
  const cell = value.replace(/`([^`\n]*)`/g, (_, content: string) => codeSpan(content)).trim();
  if (!cell) return null;
  const split = /\s[—–]\s|\s-\s|;|\(|:|\s\+\s/.exec(cell);
  return { cell, lead: split ? cell.slice(0, split.index) : cell, rest: split ? cell.slice(split.index).replace(/^\s*(?:[—–+-]\s*|[;:(]\s*)/, "").replace(/^([^()]*)\)/, "$1") : "" };
}

function kindOf<K extends string>(lead: string, vocabulary: StatusVocabulary<K>): K {
  const words = normalize(lead).replace(noFailures, " ");
  const negated = negatedPassing.test(words);
  const mark = vocabulary.marks.find(([, pattern]) => pattern.test(lead))?.[0] ?? null;
  const word = negated ? null : vocabulary.words.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
  const contradicts = (word === vocabulary.passing && mark === vocabulary.failing) || (word === vocabulary.failing && mark === vocabulary.passing) || (negated && mark === vocabulary.passing);
  return contradicts ? vocabulary.other : word ?? mark ?? vocabulary.other;
}

/** The kind alone, without building display excerpts; used to tally every row before any is projected. */
export function statusKind<K extends string>(value: string, vocabulary: StatusVocabulary<K>): K {
  const parts = splitStatus(value);
  return parts ? kindOf(parts.lead, vocabulary) : vocabulary.other;
}

/**
 * Status words decide the kind before emoji ("⚠️ MANUAL" needs a human, it is not flaky), except that a negated
 * pass ("not passing") never counts as passing and words that contradict the mark leave the status unclassified.
 */
export function classifyStatus<K extends string>(value: string, vocabulary: StatusVocabulary<K>): RecordedStatus<K> {
  const parts = splitStatus(value);
  if (!parts) return { kind: vocabulary.other, label: null, note: null };
  const { cell, lead, rest } = parts;
  const kind = kindOf(lead, vocabulary);
  const label = lead.replace(marks, "").trim();
  // Sentence-length results keep their wording as the note rather than a badge label.
  if (label.length > 48) return { kind, label: null, note: excerpt(cell.replace(/^[✅✔❌✖⬜⏳⏭⚠️️\s]+/u, ""), 240) };
  return { kind, label: label ? excerpt(label, 48) : null, note: rest ? excerpt(rest, 240) : null };
}

export function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/**
 * An ATX heading ("## Title ##") with up to `maxIndent` leading spaces, parsed without regex backtracking: a heading padded
 * with thousands of spaces costs linear time, not cubic.
 */
export function atxHeading(line: string, maxIndent = 3): { level: number; text: string } | null {
  let start = 0;
  while (start <= maxIndent && line[start] === " ") start++;
  if (start > maxIndent || line[start] !== "#") return null;
  let end = start;
  while (line[end] === "#") end++;
  const level = end - start;
  if (level > 6 || !/\s/.test(line[end] ?? "")) return null;
  const text = line.slice(end).trim();
  let close = text.length;
  while (close > 0 && text[close - 1] === "#") close--;
  const title = text.slice(0, close).trimEnd() || text;
  return title ? { level, text: title } : null;
}

/** The text after an exact heading marker ("### "), trimmed; the linear equivalent of `^###\s+(.+?)\s*$`. */
export function markedHeading(line: string, marker: string): string | null {
  if (!line.startsWith(marker) || !/\s/.test(line[marker.length] ?? "")) return null;
  return line.slice(marker.length).trim() || null;
}

export function readSections(body: string): Section[] | null {
  const sections: Section[] = [{ heading: null, lines: [] }];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (line.length > maxLineLength) return null;
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = atxHeading(line, 0);
    if (heading?.level === 2) sections.push({ heading: heading.text, lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  return fenced ? null : sections;
}

export function readTables(lines: readonly string[]): { tables: Table[]; prose: string[] } {
  const tables: Table[] = [];
  const prose: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("|") && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/.test(lines[index + 1]?.trim() ?? "")) {
      const table: Table = { header: splitRow(line), rows: [] };
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) table.rows.push(splitRow(lines[index++]));
      index -= 1;
      tables.push(table);
    } else prose.push(lines[index]);
  }
  return { tables, prose };
}

/** A list item or labelled line continues on following indented or plain lines until a blank line, list item, table or heading. */
export function withContinuation(lines: readonly string[], start: number, first: string): string {
  const parts = [first];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || /^(?:---|[-*]\s|\d+\.\s|#|>|\||\*\*[^*]+:?\*\*)/.test(trimmed)) break;
    parts.push(trimmed);
  }
  return parts.join(" ");
}

/** The first paragraph, excluding lists, tables and emphasis-only captions. */
export function firstParagraph(lines: readonly string[]): string | null {
  const paragraph: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:---|[-*]\s|\d+\.\s|#|>|\|)/.test(trimmed) || /^\*[^*].*\*$/.test(trimmed)) { if (paragraph.length) break; continue; }
    paragraph.push(trimmed);
  }
  return paragraph.length ? paragraph.join(" ") : null;
}

export function frontmatter(text: string): { values: Map<string, string | null>; body: string } | null {
  const values = new Map<string, string | null>();
  if (!text.startsWith("---\n")) return { values, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0 || end > 32_768 || !/^\n---\s*(?:\n|$)/.test(text.slice(end, end + 8))) return null;
  for (const line of text.slice(4, end).split("\n")) {
    const entry = /^([a-z][a-z0-9_]*):\s*(.*)$/i.exec(line);
    if (!entry) continue;
    const raw = entry[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
    values.set(entry[1], values.has(entry[1]) ? null : value);
  }
  return { values, body: text.slice(end + 4) };
}

export const date = (value: string | null | undefined) => /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value ?? "")?.[1] ?? null;
export const flag = (value: string | null | undefined) => value === "true" ? true : value === "false" ? false : null;

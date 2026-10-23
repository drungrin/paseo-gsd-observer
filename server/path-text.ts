import { atxHeading, decodeDocument, excerpt, leadExcerpt } from "./document-text.js";

/** Shared reading of GSD Path documents. Both the upstream package and forks write the same line formats, so nothing here depends on a version. */

const maxLineLength = 16_384;
const maxFrontmatter = 65_536;
export const PATH_PIPELINE = "gsd-path/v2";
export const taskIdPattern = /^T\d{3,6}$/;
export const milestoneIdPattern = /^M\d{3,6}$/;
export const tokenPattern = /^[a-z][a-z0-9-]{0,31}$/;
// Both editions validate project and milestone names with this rule.
export const slugPattern = /^[a-z0-9][a-z0-9-]{0,127}$/;
// Branch names are shown as recorded ("feature/milestone-001" in a fork, "gsd-path/M001" upstream) and never parsed.
export const branchPattern = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
export const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Templates and the runtime write guidance as HTML comments, some spanning lines after a value ("Lane: quick   <!-- … -->"); none of it is evidence. */
export function withoutComments(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("<!--", index);
    if (start < 0) return result + text.slice(index);
    result += text.slice(index, start);
    const end = text.indexOf("-->", start + 4);
    // An unclosed comment hides the rest of the document, as it does in rendered Markdown.
    if (end < 0) return result;
    result += text.slice(start, end).replace(/[^\n]/g, "");
    index = end + 3;
  }
  return result;
}

/** Document lines outside fenced code, or null when a line is too long or a fence never closes. */
export function proseLines(text: string): string[] | null {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    if (line.length > maxLineLength) return null;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null; continue; }
    if (marker) { fence = marker; continue; }
    lines.push(line);
  }
  return fence ? null : lines;
}

export type PathFields = { values: Map<string, string | null>; lists: Map<string, string[]>; body: string };

const listValue = (raw: string) => raw.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean);

/**
 * YAML-like frontmatter as GSD Path writes it: `key: value  # comment`, inline `[a, b]` lists and indented `- item` block lists.
 * Indented comment lines are guidance. A repeated key is ambiguous, so its value becomes null.
 */
export function pathFrontmatter(text: string): PathFields | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0 || end > maxFrontmatter || !/^\n---\s*(?:\n|$)/.test(text.slice(end, end + 8))) return null;
  const values = new Map<string, string | null>();
  const lists = new Map<string, string[]>();
  const lines = text.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const entry = /^([a-z][a-z0-9_]*):(.*)$/.exec(lines[index]);
    if (!entry) continue;
    const key = entry[1];
    const raw = entry[2].replace(/(?:^|\s+)#.*$/, "").trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    let value: string | null = quoted ? quoted[2] : raw === "null" || raw === "~" ? null : raw;
    if (value !== null && /^\[.*\]$/.test(value)) { lists.set(key, listValue(value)); value = null; }
    else if (value === "") {
      const items: string[] = [];
      while (index + 1 < lines.length && /^\s+(?:-\s|#)/.test(lines[index + 1])) {
        const item = /^\s+-\s+(.+?)\s*$/.exec(lines[index += 1]);
        if (item) items.push(item[1]);
      }
      if (items.length) { lists.set(key, items); value = null; }
    }
    if (values.has(key)) { values.set(key, null); lists.delete(key); continue; }
    values.set(key, value);
  }
  return { values, lists, body: text.slice(end + 4) };
}

/** A document's text for parsing: strict UTF-8, LF line endings, no NUL. */
export function pathDocument(bytes: Uint8Array | undefined): string | null {
  const text = bytes ? decodeDocument(bytes) : null;
  return text && !text.includes("\0") ? text : null;
}

/** A labelled line at the start of a line ("Status: active", "Wave verdict: pass"); token fields drop a trailing `# comment`. */
export function labelled(line: string, label: string, token = false): string | null {
  if (!line.startsWith(`${label}:`)) return null;
  const value = line.slice(label.length + 1).trim();
  return (token ? value.replace(/\s+#.*$/, "").trim() : value) || null;
}

/** The first labelled value among the lines, ignoring repeats. */
export function firstLabelled(lines: readonly string[], label: string, token = false): string | null {
  for (const line of lines) {
    const value = labelled(line, label, token);
    if (value !== null) return value;
  }
  return null;
}

/** A recorded lowercase token (phase, status, verdict); anything else is not a token and is not shown. */
export const token = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized && tokenPattern.test(normalized) ? normalized : null;
};

/** A level-2 or level-3 heading split from its content lines. */
export function headings(lines: readonly string[], level: 2 | 3): { heading: string; lines: string[] }[] {
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of lines) {
    const heading = atxHeading(line, 0);
    if (heading && heading.level <= level) {
      if (heading.level === level) sections.push({ heading: heading.text, lines: [] });
      else if (sections.length) sections.push({ heading: "", lines: [] });
      continue;
    }
    sections.at(-1)?.lines.push(line);
  }
  return sections.filter((section) => section.heading);
}

/** "M001 — slug", "Wave 2 — walking skeleton", "T004 — title": the identifier and the text after an em dash, en dash or spaced hyphen. */
export function dashed(heading: string): { lead: string; rest: string | null } {
  const split = /\s+[—–-]\s+/.exec(heading);
  return split ? { lead: heading.slice(0, split.index).trim(), rest: heading.slice(split.index + split[0].length).trim() || null } : { lead: heading.trim(), rest: null };
}

/**
 * Prose for display: the whole value when it is a safe excerpt, else its first sentence, else the value cut at a word. Long
 * goals and titles are shortened rather than withheld; wording that is unsafe at any length still is.
 */
export function shortExcerpt(value: string | null | undefined, max: number): { text: string | null; shortened: boolean } {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return { text: null, shortened: false };
  const lead = leadExcerpt(text, max);
  if (lead.text || text.length <= max) return lead;
  // Masking can lengthen a cut ("a/b" becomes "[omitted]"), so the cut leaves room for it.
  const cut = text.slice(0, Math.floor(max * 0.9));
  const word = cut.lastIndexOf(" ");
  return { text: excerpt(`${word > max / 2 ? cut.slice(0, word) : cut}…`, max), shortened: true };
}

import type { AllowedArtifact, ArtifactKind, InventoryWarning } from "./allowed-reader.js";
import { markedHeading } from "./document-text.js";

export type Decoded<T> =
  | { availability: "available"; value: T; warnings: [] }
  | { availability: "unknown" | "unsupported"; warnings: InventoryWarning[] };

export type DecodedArtifact = { kind: ArtifactKind; phaseId?: string; planId?: string; title?: string; planTitle?: string; planGoal?: string; fields: Readonly<Record<string, string | readonly string[]>> };
const MAX_LINE_LENGTH = 4_096;
const MAX_FRONTMATTER_LINES = 512;
const MAX_PLAN_TITLE_LENGTH = 160;
const MAX_PLAN_GOAL_LENGTH = 640;
const phaseId = /^\d+(?:\.\d+)*$/;
const planId = /^\d+$/;
const forbiddenKey = /^(?:__proto__|prototype|constructor)$/i;
const observedFrontmatterKeys = new Set(["version", "phase", "plan", "title", "status", "covered_files", "covered_digest"]);

const normalizeSegment = (value: string) => {
  const trimmed = value.trim();
  if (!phaseId.test(trimmed) || trimmed.length > 64) return null;
  return trimmed.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".");
};
const normalizePhaseLabel = (value: string) => {
  const numeric = normalizeSegment(value);
  if (numeric) return numeric;
  const slug = /^(\d+(?:\.\d+)*)-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.exec(value.trim());
  return slug ? normalizeSegment(slug[1]) : null;
};
const normalizePlan = (value: string) => planId.test(value.trim()) && value.trim().length <= 64 ? value.trim().replace(/^0+(?=\d)/, "") : null;
const scalar = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || /[\[\]{}&*!]|<<|\b(?:null|true|false)\b/i.test(trimmed)) return null;
  const quoted = /^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)')$/.exec(trimmed);
  if (quoted) return (quoted[1] ?? quoted[2]).replace(/\\(["\\])/g, "$1");
  return /^[\p{L}\p{N} ,._:/-]+$/u.test(trimmed) ? trimmed : null;
};

function decodeFrontmatter(text: string): Decoded<Readonly<Record<string, string | readonly string[]>>> {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { availability: "available", value: Object.freeze({}), warnings: [] };
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return { availability: "unknown", warnings: ["truncated"] };
  const fields: Record<string, string | readonly string[]> = Object.create(null);
  const lines = normalized.slice(4, end).split("\n");
  if (lines.length > MAX_FRONTMATTER_LINES) return { availability: "unsupported", warnings: ["unsupported"] };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (line.length > MAX_LINE_LENGTH) {
      if (/^covered_files:\s*/.test(line) && !Object.hasOwn(fields, "covered_files")) { fields.covered_files = Object.freeze([]); continue; }
      return { availability: "unsupported", warnings: ["unsupported"] };
    }
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match || forbiddenKey.test(match[1]) || Object.hasOwn(fields, match[1])) return { availability: "unknown", warnings: ["malformed"] };
    if (!observedFrontmatterKeys.has(match[1])) continue;
    const value = match[2].trim();
    if (match[1] === "covered_files" && !value) {
      const files: string[] = [];
      while (index + 1 < lines.length && /^\s/.test(lines[index + 1])) {
        const entry = lines[++index];
        if (entry.length > MAX_LINE_LENGTH) return { availability: "unsupported", warnings: ["unsupported"] };
        const listItem = /^\s+-\s+(.+)$/.exec(entry);
        const parsed = listItem ? scalar(listItem[1]) : null;
        if (!parsed) return { availability: "unknown", warnings: ["malformed"] };
        files.push(parsed);
      }
      if (!files.length) return { availability: "unknown", warnings: ["malformed"] };
      fields[match[1]] = Object.freeze(files);
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",").map(scalar);
      if (!items.length || items.some((item) => item === null)) return { availability: "unknown", warnings: ["malformed"] };
      fields[match[1]] = Object.freeze(items as string[]);
    } else {
      const parsed = scalar(value);
      if (parsed === null) return { availability: "unknown", warnings: ["malformed"] };
      fields[match[1]] = parsed;
    }
  }
  const version = fields.version;
  if (typeof version === "string" && version !== "1") return { availability: "unsupported", warnings: ["unsupported"] };
  return { availability: "available", value: Object.freeze(fields), warnings: [] };
}

/** Read only a simple H1 plan heading; arbitrary PLAN.md body text is never display data. */
function decodePlanTitle(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, "\n");
  const bodyStart = normalized.startsWith("---\n") ? normalized.indexOf("\n---\n", 4) + 5 : 0;
  if (bodyStart < 0) return undefined;
  for (const line of normalized.slice(bodyStart, bodyStart + 8_192).split("\n").slice(0, 32)) {
    const heading = markedHeading(line, "#");
    if (!heading) continue;
    const withoutPrefix = heading.replace(/^(?:(?:phase|fase)\s+\d+(?:\.\d+)*\s+)?(?:plan|plano)\s+\d+(?:\.\d+)*\s*(?:[:—–-]\s*)?/i, "");
    const value = withoutPrefix.replace(/\s+/g, " ").trim();
    if (!value || /^(?:plan|plano)$/i.test(value) || value.length > MAX_PLAN_TITLE_LENGTH) return undefined;
    if (!/^[\p{L}\p{N} .,;:!?'"&()+—–-]+$/u.test(value)) return undefined;
    if (/(?:https?:\/\/|[\\/]|\b(?:secret|token|password|api[_-]?key|prompt|authorization|bearer)\b|AKIA[0-9A-Z]{16})/i.test(value)) return undefined;
    return value;
  }
  const objective = planBlock(normalized, "objective");
  const firstLine = objective?.split("\n").find((line) => line.trim() && !/^(?:Purpose|Output):\s*/i.test(line));
  const objectiveTitle = firstLine ? safeObjectiveTitle(firstLine) : undefined;
  if (objectiveTitle) return objectiveTitle;
  const taskName = /<task\b[^>]*>[\s\S]{0,8192}?<name>\s*([^<]{1,512})\s*<\/name>/i.exec(normalized)?.[1];
  return taskName ? safeObjectiveTitle(taskName.replace(/^(?:tarefa|task)\s+\d+\s*:\s*/i, "")) : undefined;
}

function safePlanText(value: string, maxLength: number): string | undefined {
  const normalized = value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  if (!/^[\p{L}\p{N} .,;:!?"'&()+—–-]+$/u.test(normalized)) return undefined;
  if (/(?:https?:\/\/|[\\/]|\b(?:secret|token|password|api[_-]?key|prompt|authorization|bearer)\b|AKIA[0-9A-Z]{16})/i.test(normalized)) return undefined;
  return normalized;
}

function safeObjectiveTitle(value: string): string | undefined {
  const normalized = value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const visible = normalized.slice(0, MAX_PLAN_TITLE_LENGTH - 1);
  const boundary = visible.lastIndexOf(" ");
  const title = normalized.length <= MAX_PLAN_TITLE_LENGTH ? normalized : `${(boundary > 64 ? visible.slice(0, boundary) : visible).trimEnd()}…`;
  if (/(?:https?:\/\/|[\\\\]|\b(?:secret|token|password|api[_-]?key|prompt|authorization|bearer)\b|AKIA[0-9A-Z]{16})/i.test(title)) return undefined;
  const parts = title.split("/");
  if (parts.length > 8 || parts.some((part) => !/^[\p{L}\p{N} \[\]|=.,;:!?"'&()+_→…—–-]+$/u.test(part.trim()))) return undefined;
  return title;
}

function planBlock(text: string, tag: "objective"): string | undefined {
  const normalized = text.replace(/\r\n?/g, "\n");
  const matches = [...normalized.matchAll(new RegExp(`<${tag}>\\s*([\\s\\S]{0,8192}?)\\s*<\\/${tag}>`, "gi"))];
  return matches.length === 1 ? matches[0][1] : undefined;
}

function decodePlanGoal(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, "\n");
  const story = normalized.slice(0, 8_192).split("\n").find((line) => /^\s*\*\*As a\*\*/i.test(line));
  if (story) return safePlanText(story, MAX_PLAN_GOAL_LENGTH);
  const objective = planBlock(normalized, "objective");
  const firstParagraph = objective?.split(/\n\s*\n/)[0];
  return firstParagraph ? safePlanText(firstParagraph, MAX_PLAN_GOAL_LENGTH) : undefined;
}

const planFromName = (key: string) => /-(\d+)-(?:PLAN|SUMMARY)\.md$/i.exec(key)?.[1] ?? null;

export function decodeArtifact(artifact: AllowedArtifact): Decoded<DecodedArtifact> {
  const text = new TextDecoder().decode(artifact.bytes);
  const decoded = decodeFrontmatter(text);
  if (decoded.availability !== "available") return decoded;
  const fields = decoded.value;
  const fieldPhase = typeof fields.phase === "string" ? normalizePhaseLabel(fields.phase) : null;
  if (typeof fields.phase === "string" && !fieldPhase) return { availability: "unknown", warnings: ["malformed"] };
  if (fieldPhase && artifact.phaseId && fieldPhase !== artifact.phaseId) return { availability: "unknown", warnings: ["inconsistent"] };
  const filePlan = planFromName(artifact.key);
  const fieldPlan = typeof fields.plan === "string" ? normalizePlan(fields.plan) : null;
  if (typeof fields.plan === "string" && !fieldPlan) return { availability: "unknown", warnings: ["malformed"] };
  if (fieldPlan && filePlan && fieldPlan !== normalizePlan(filePlan)) return { availability: "unknown", warnings: ["inconsistent"] };
  const title = typeof fields.title === "string" ? fields.title : undefined;
  const planTitle = artifact.kind === "plan" ? decodePlanTitle(text) : undefined;
  const planGoal = artifact.kind === "plan" ? decodePlanGoal(text) : undefined;
  return { availability: "available", value: { kind: artifact.kind, phaseId: fieldPhase ?? artifact.phaseId, planId: fieldPlan ?? (filePlan ? normalizePlan(filePlan) ?? undefined : undefined), title, ...(planTitle ? { planTitle } : {}), ...(planGoal ? { planGoal } : {}), fields }, warnings: [] };
}

export function comparePhaseIds(left: string, right: string): number {
  const a = left.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  const b = right.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index].length !== b[index].length) return a[index].length - b[index].length;
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

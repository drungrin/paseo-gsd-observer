import { createHash } from "node:crypto";
import { BoardDebugSchema, DebugSessionSchema, type BoardDebug, type DebugLocation, type DebugNote, type DebugSession, type DebugStatusKind } from "../shared/debug.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { atxHeading, date, decodeDocument, frontmatter, maskedExcerpt, normalize, readSections, statusParts, withContinuation, type Section } from "./document-text.js";

const maxSessions = 160;
const maxDetailCharacters = 96_000;
const maxValueCharacters = 8_192;
const maxCount = 100_000;
// At most two dots: an IPv4 address cannot masquerade as a phase identifier.
const phasePattern = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/;
const addCount = (count: number, increment = 1) => Math.min(maxCount, count + increment);
const emptyCounts = (): BoardDebug["counts"] => ({ active: 0, archived: 0, attention: 0, unresolved: 0, open: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 0, unclassified: 0,
  reconciliation: 0, unavailable: 0, knowledgeBase: 0, notes: 0, displayed: 0 });
const unavailable = (limited: boolean): BoardDebug => ({ availability: "unavailable", directoryState: "unknown", archiveState: "unknown", sessions: [], counts: emptyCounts(), countsComplete: false, limited });

type Candidate = { artifact: AllowedArtifact; location: DebugLocation; filename: string };
type Field = { text: string | null; structured: boolean; items: number | null; ambiguous: boolean };
type Parsed = { session: DebugSession; filename: string };
const empty: Field = { text: null, structured: false, items: null, ambiguous: false };
const detailKeys = ["trigger", "expected", "actual", "hypothesis", "nextAction", "rootCause", "fix", "verification"] as const;
const symptomKeys = ["expected", "actual", "errors", "reproduction", "started", "timeline"] as const;
// Sections that only GSD debug sessions carry; a Markdown note with none of them (and no status) is not a session.
const sessionSections = new Set(["current focus", "symptoms", "symptom", "sintomas", "sintoma", "root cause", "root causes", "causa raiz", "evidence", "evidencias", "evidencia",
  "eliminated", "eliminated hypotheses", "hipoteses eliminadas", "hypotheses tested", "resolution", "verified resolution"]);
const recordLine = /^(?:-\s+)?[a-z][a-z0-9]*_[a-z0-9_]*:(?:\s|$)/;

const statusWords: readonly (readonly [DebugStatusKind, RegExp])[] = [
  ["open", /^(?:gathering|investigating|fixing|verifying|active|open|in-progress|reopened|investigando|em-andamento)$/],
  ["diagnosed", /^(?:diagnosed|root-cause-found|diagnosticad[oa])$/],
  ["awaiting-verification", /^(?:awaiting|pending|fixed-pending|aguardando)(?:-human)?-(?:verify|verification|validation|verificacao|validacao)$/],
  ["blocked", /^(?:blocked|bloquead[oa])$/],
  ["resolved", /^(?:resolved|closed|resolvid[oa]|fechad[oa]|encerrad[oa])$/],
];
const rank: Record<DebugStatusKind, number> = { blocked: 0, "awaiting-verification": 1, open: 2, diagnosed: 3, other: 4, unrecorded: 5, resolved: 6 };

/** Only the reader's debug namespace: the active directory or its resolved archive. */
function candidate(artifact: AllowedArtifact): Candidate | null {
  if (artifact.kind !== "debug" || artifact.phaseId) return null;
  const match = /^debug\/(?:(resolved)\/)?([^/\\]+\.md)$/.exec(artifact.key);
  return match ? { artifact, location: match[1] ? "archived" : "active", filename: match[2] } : null;
}

/** The recorded status word decides the kind; qualifiers after it ("RESOLVED — fixed by plan 15-08") are wording, not a different state. */
function status(raw: string | null | undefined): { kind: DebugStatusKind; label: string | null } {
  const value = raw?.trim();
  if (!value) return { kind: "unrecorded", label: null };
  const lead = (statusParts(value)?.lead ?? value).split(",")[0].trim();
  const words = normalize(lead).replace(/[_\s]+/g, "-");
  return { kind: statusWords.find(([, pattern]) => pattern.test(words))?.[0] ?? "other", label: maskedExcerpt(lead, 64).text };
}

const text = (value: string): Field => {
  const trimmed = value.trim();
  return trimmed && trimmed !== '""' && trimmed !== "''" && !/^(?:null|~)$/i.test(trimmed) ? { ...empty, text: trimmed } : empty;
};

/** A double- or single-quoted YAML scalar, possibly folded across lines; an unterminated quote keeps its text but is marked ambiguous. */
function quoted(value: string): Field {
  const quote = value[0];
  let out = "";
  for (let index = 1; index < value.length; index++) {
    const character = value[index];
    if (quote === "\"" && character === "\\" && index + 1 < value.length) { const next = value[++index]; out += next === "n" || next === "t" ? " " : next; continue; }
    if (character === quote) {
      if (quote === "'" && value[index + 1] === "'") { out += "'"; index++; continue; }
      // A quoted phrase that opens a sentence ("\"Cache\" is stale") is prose; keeping only the phrase would change its meaning.
      return value.slice(index + 1).trim() ? text(value) : text(out);
    }
    out += character;
  }
  return { ...text(out), ambiguous: true };
}

/** "[a, b]" item count; entries themselves (often paths) are never displayed. Text after the list ("[unconfirmed] the cache") is prose. */
function flowList(value: string): Field {
  let depth = 0;
  let items = 0;
  let content = false;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) { if (character === quote) quote = null; continue; }
    if (depth >= 1 && (character === "\"" || character === "'")) { quote = character; content = true; continue; }
    if (character === "[" || character === "{") { depth++; if (depth === 1) continue; }
    else if (character === "]" || character === "}") {
      depth--;
      if (depth === 0) return value.slice(index + 1).trim() ? text(value) : { ...empty, items: Math.min(maxCount, items + (content ? 1 : 0)) };
    }
    else if (character === "," && depth === 1) { if (content) items++; content = false; continue; }
    if (depth >= 1 && character.trim()) content = true;
  }
  return { ...empty, ambiguous: true };
}

/** HTML comments removed by position scanning: a line of unclosed "<!--" costs linear time. */
function withoutComments(value: string): string {
  let out = "";
  let index = 0;
  for (;;) {
    const open = value.indexOf("<!--", index);
    if (open < 0) return out + value.slice(index);
    const close = value.indexOf("-->", open + 4);
    if (close < 0) return out + value.slice(index, open);
    out += value.slice(index, open);
    index = close + 3;
  }
}

function value(raw: string, continuation: readonly string[], truncated: boolean): Field {
  const body = continuation.map((line) => line.trim());
  const limited = (field: Field): Field => truncated ? { ...field, ambiguous: true } : field;
  // A block or list whose first line is itself "snake_key: value" is a record written as text, not prose.
  if (/^[|>][+-]?[1-9]?$/.test(raw)) return recordLine.test(body[0] ?? "") ? { ...empty, structured: true } : limited(text(body.join(" ")));
  if (!raw || /^(?:null|~)$/i.test(raw)) {
    if (!body.length) return empty;
    if (/^-(?:\s|$)/.test(body[0])) {
      const indent = /^[ \t]*/.exec(continuation[0])![0].length;
      const items = continuation.filter((line) => /^[ \t]*/.exec(line)![0].length === indent && /^-(?:\s|$)/.test(line.trim())).map((line) => line.trim().replace(/^-\s*/, ""));
      if (recordLine.test(body[0])) return { ...empty, structured: true, items: Math.min(maxCount, items.length) };
      return limited({ ...empty, text: items.filter(Boolean).join("; ") || null, items: Math.min(maxCount, items.length) });
    }
    if (/^[a-z_][\w-]*:(?:\s|$)/i.test(body[0])) return { ...empty, structured: true };
    if (body[0].startsWith("\"") || body[0].startsWith("'")) return limited(quoted(body.join(" ")));
    return limited(text(body.join(" ")));
  }
  if (raw.startsWith("\"") || raw.startsWith("'")) return limited(quoted([raw, ...body].join(" ")));
  if (raw.startsWith("[")) return limited(flowList([raw, ...body].join(" ")));
  if (raw.startsWith("{")) return { ...empty, structured: true };
  return limited(text([raw, ...body].join(" ")));
}

/**
 * Top-level "key: value" entries of a debug section, read the way GSD writes them (optionally as "- key: value" list items): block
 * scalars, quoted or plain values folded onto indented lines, lists and nested maps. Subsections ("### Suggested fix direction") are
 * prose about the record, not the record.
 */
function fields(lines: readonly string[]): Map<string, Field> {
  const result = new Map<string, Field>();
  let comment = false;
  for (let index = 0; index < lines.length;) {
    const line = lines[index++];
    if (comment) { if (line.includes("-->")) comment = false; continue; }
    if (/^\s*<!--/.test(line) && !line.includes("-->")) { comment = true; continue; }
    if (/^#{3,6}\s/.test(line)) break;
    const entry = /^(?:[-*][ \t]+)?([a-z][a-z0-9_]*):(?:[ \t]+(.*))?$/i.exec(line);
    if (!entry) continue;
    const continuation: string[] = [];
    let size = 0;
    while (index < lines.length && (!lines[index].trim() || /^[ \t]/.test(lines[index]))) {
      const next = lines[index++];
      if (next.trim() && size < maxValueCharacters) { continuation.push(next); size += next.length; }
    }
    const key = entry[1].toLowerCase();
    const field = value(withoutComments(entry[2] ?? "").trim(), continuation, size >= maxValueCharacters);
    // A repeated key is two competing records, not the later one.
    result.set(key, result.has(key) ? { ...empty, ambiguous: true } : field);
  }
  return result;
}

/** Bold-label prose ("**Actual:** …", "- **Expected behavior:** …") used by sessions written before the keyed template. */
function labelled(lines: readonly string[], label: RegExp): string | null {
  for (let index = 0; index < lines.length; index++) {
    const match = /^(?:[-*]\s+)?\*\*([^*]{1,60}?):?\*\*:?\s*(.*)$/.exec(lines[index].trim());
    if (match && label.test(normalize(match[1]))) return withContinuation(lines, index, match[2]);
  }
  return null;
}

/**
 * The first unindented prose paragraph, never a list item's continuation or a bold label. A paragraph that introduces a list
 * ("Two layers compound:") carries up to four of its top-level items.
 */
function leadParagraph(lines: readonly string[]): string | null {
  const paragraph: string[] = [];
  let end = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const prose = trimmed && !/^\s/.test(line) && !/^(?:---|[-*]\s|\d+\.\s|#|>|\||<!--)/.test(trimmed) && !/^\*\*[^*]+\*\*/.test(trimmed) && !/^\*[^*].*\*$/.test(trimmed)
      && !/^[a-z][a-z0-9_]*:(?:\s|$)/.test(trimmed);
    if (prose) { paragraph.push(trimmed); end = index; continue; }
    if (paragraph.length) break;
  }
  if (!paragraph.length) return null;
  const text = paragraph.join(" ");
  if (!text.endsWith(":")) return text;
  const items: string[] = [];
  for (let index = end + 1; index < lines.length && items.length < 4; index++) {
    const item = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(lines[index])?.[1];
    if (item) items.push(withContinuation(lines, index, item).replace(/\*\*/g, "").replace(/[.;]\s*$/, ""));
    else if (lines[index].trim() && !/^\s/.test(lines[index])) break;
  }
  return items.length ? `${text} ${items.join("; ")}` : text;
}

const sectionName = (heading: string) => normalize(heading).replace(/\(.*$/, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
const listItems = (lines: readonly string[]) => Math.min(maxCount, lines.filter((line) => /^(?:[-*]|\d+\.)\s+\S/.test(line)).length);

/** A single named class; a session that records several classes ("bohrbug for A; heisenbug-mandelbug for B") has none. */
function bugClass(value: string | null | undefined): DebugSession["bugClass"] {
  if (!value) return null;
  const words = normalize(value);
  const classes = new Set([...words.matchAll(/\b(bohrbug|heisenbug[- ]?mandelbug|concurrency)\b/g)].map((match) => match[1].startsWith("heisenbug") ? "heisenbug-mandelbug" as const : match[1] as "bohrbug" | "concurrency"));
  return classes.size === 1 && /^\W*(?:bohrbug|heisenbug|concurrency)/.test(words) ? [...classes][0] : null;
}

/**
 * The session name `/gsd-debug` resumes by. It is an identifier, not prose: dots only before digits ("12.4"), so it never reads
 * as a host or file; no IPv4 address, digest, UUID or credential-shaped segment.
 */
function displaySlug(slug: string): string | null {
  if (slug.length > 96 || !/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+|\.\d+)*$/.test(slug) || /\d+(?:\.\d+){3}/.test(slug)) return null;
  if (/[0-9a-f]{32}/i.test(slug.replace(/[-_]/g, "")) || /(?:^|[-_])(?:gh[pousr]_|github_pat_|sk-|akia[0-9a-z]{8})/i.test(slug)) return null;
  return slug.split(/[-_.]/).every((segment) => segment.length <= 40) ? slug : null;
}

function phase(value: string | null | undefined): string | null {
  const match = /^(\d+(?:\.\d+){0,2})(?=$|[\s(-])/.exec(value?.trim() ?? "");
  const id = match?.[1].split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".");
  return id && phasePattern.test(id) ? id : null;
}

function parse(candidate: Candidate): Parsed | "knowledge-base" | "note" | null {
  const { artifact, location, filename } = candidate;
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return null;
  const source = decodeDocument(artifact.bytes);
  if (source === null || source.includes("\0")) return null;
  const matter = frontmatter(source);
  if (!matter) return null;
  const meta = matter.values;
  if (/^knowledge-base\.md$/i.test(filename) || normalize(meta.get("type") ?? "").replace(/[\s-]+/g, "_") === "knowledge_base") return "knowledge-base";
  // frontmatter() marks repeated keys null; a repeated status is ambiguous, not an absent status.
  if (meta.has("status") && meta.get("status") === null) return null;
  // Frontmatter values may be block scalars or folded quotes ("trigger: |"); read them with the section reader.
  const front = fields(source.startsWith("---\n") ? source.slice(4, source.indexOf("\n---", 3)).split("\n") : []);
  const sections = readSections(matter.body);
  // Without readable structure a status could only come from the frontmatter; its absence would otherwise read as "no status".
  if (!sections && !meta.get("status")) return null;
  let limited = sections === null;
  const intro = sections?.[0].lines ?? [];
  let heading: string | null = null;
  const bodyStatuses: string[] = [];
  for (const line of intro) {
    const h1 = atxHeading(line, 0);
    if (h1?.level === 1) heading ??= h1.text;
    const bold = /^\*\*(?:status|estado)(?::\*\*|\*\*:)\s*(.+)$/i.exec(line.trim())?.[1];
    if (bold) bodyStatuses.push(bold);
  }
  // Sessions without frontmatter may still record "status:" and "phase:" as plain preamble lines.
  const preamble = fields(intro);
  const keyedStatus = preamble.get("status");
  if (keyedStatus?.text) bodyStatuses.push(keyedStatus.text);
  if (!meta.has("status") && (bodyStatuses.length > 1 || keyedStatus?.ambiguous)) return null;

  const named = (sections ?? []).slice(1).map((section) => ({ section, name: sectionName(section.heading ?? "") }));
  const isSession = meta.has("status") || meta.has("trigger") || meta.has("created") || bodyStatuses.length > 0 || /^debug(?:\s+session)?\s*[:—–-]/i.test(heading ?? "")
    || named.some((entry) => sessionSections.has(entry.name));
  if (!isSession) return "note";
  const recorded = status(meta.has("status") ? meta.get("status") : bodyStatuses[0]);

  const first = (...names: string[]): Section | undefined => named.find((entry) => names.includes(entry.name))?.section;
  const itemCount = (...names: string[]) => { const section = first(...names); return section ? listItems(section.lines) : null; };
  const focus = fields(first("current focus")?.lines ?? []);
  const symptomSection = first("symptoms", "symptom", "sintomas", "sintoma");
  const symptoms = fields(symptomSection?.lines ?? []);
  const resolutions = named.filter((entry) => entry.name === "resolution" || entry.name === "verified resolution");
  const primary = resolutions.find((entry) => entry.name === "resolution") ?? resolutions[0];
  const resolution = fields(primary?.section.lines ?? []);
  const rootCauseSection = first("root cause", "root causes", "causa raiz");
  // Every resolution section's own status line is compared, the primary one included; a reconciliation note may be the only one.
  const sectionStatuses = resolutions.map((entry) => (entry === primary ? resolution : fields(entry.section.lines)).get("status")).filter((field): field is Field => !!field);
  if (sectionStatuses.some((field) => field.ambiguous)) limited = true;
  const statusConflict = sectionStatuses.some((field) => field.text && status(field.text).kind !== recorded.kind);

  const slug = filename.replace(/\.md$/i, "");
  const headingTitle = heading?.replace(/^debug(?:\s+session)?\s*[:—–-]\s*/i, "").trim() || null;
  const titleSource = front.get("title")?.text || headingTitle;
  const title = maskedExcerpt(titleSource, 200);

  // A template key, even empty or repeated, is the record: labels and prose are read only for sessions written without keys.
  const keyedSymptoms = symptomKeys.some((key) => symptoms.has(key));
  const expectedSource = symptoms.has("expected") ? symptoms.get("expected")!.text : symptomSection ? labelled(symptomSection.lines, /\b(?:expected|esperado|truth)\b/) : null;
  const actualSource = symptoms.has("actual") ? symptoms.get("actual")!.text
    : (symptomSection ? labelled(symptomSection.lines, /\b(?:actual|observed|obtido|observado)\b/) : null) ?? (symptomSection && !keyedSymptoms && !expectedSource ? leadParagraph(symptomSection.lines) : null);
  const rootCauseField = resolution.get("root_cause") ?? resolution.get("root_causes");
  const rootCauseSource = rootCauseField?.text ?? (rootCauseSection ? fields(rootCauseSection.lines).get("root_cause")?.text ?? leadParagraph(rootCauseSection.lines) : null);
  const verification = resolution.get("verification");
  const sources: Record<typeof detailKeys[number], string | null | undefined> = {
    trigger: front.get("trigger")?.text, expected: expectedSource, actual: actualSource,
    hypothesis: focus.get("hypothesis")?.text, nextAction: focus.get("next_action")?.text,
    rootCause: rootCauseSource, fix: resolution.get("fix")?.text, verification: verification?.text,
  };
  const maxima: Record<typeof detailKeys[number], number> = { trigger: 480, expected: 320, actual: 320, hypothesis: 480, nextAction: 400, rootCause: 640, fix: 480, verification: 320 };
  const details = Object.fromEntries(detailKeys.map((key) => {
    const result = maskedExcerpt(sources[key], maxima[key]);
    if (result.limited) limited = true;
    return [key, result.text];
  })) as Record<typeof detailKeys[number], string | null>;
  const detailFields = [front.get("trigger"), symptoms.get("expected"), symptoms.get("actual"), focus.get("hypothesis"), focus.get("next_action"), rootCauseField, resolution.get("fix")];
  if (title.limited || (titleSource && !title.text) || detailFields.some((field) => field?.structured)
    || [front.get("trigger"), front.get("title"), ...focus.values(), ...symptoms.values(), ...resolution.values()].some((field) => field?.ambiguous)) limited = true;

  const goal = normalize(meta.get("goal") ?? "").replace(/[\s-]+/g, "_");
  const notes: DebugNote[] = [];
  if (location === "archived" && recorded.kind !== "resolved") notes.push("archived-unresolved");
  if (location === "active" && recorded.kind === "resolved") notes.push("resolved-not-archived");
  if (statusConflict) notes.push("resolution-status");
  const session: DebugSession = {
    id: createHash("sha256").update(`${location}\0${filename}`).digest("hex").slice(0, 12),
    location, slug: displaySlug(slug), title: title.text,
    statusKind: recorded.kind, recordedStatus: recorded.label,
    goal: goal === "find_root_cause_only" ? "diagnose-only" : goal === "find_and_fix" ? "find-and-fix" : null,
    bugClass: bugClass(focus.get("bug_class")?.text ?? meta.get("bug_class")),
    phaseId: phase(meta.get("phase") ?? preamble.get("phase")?.text),
    createdAt: date(meta.get("created") ?? preamble.get("created")?.text), updatedAt: date(meta.get("updated") ?? preamble.get("updated")?.text),
    resolvedAt: date(meta.get("resolved") ?? meta.get("resolved_at") ?? preamble.get("resolved")?.text),
    notes, ...details,
    verificationStructured: verification?.structured ?? false,
    evidenceCount: itemCount("evidence", "evidencias", "evidencia"),
    eliminatedCount: itemCount("eliminated", "eliminated hypotheses", "hipoteses eliminadas"),
    filesChangedCount: resolution.get("files_changed")?.items ?? null,
    detailsWithheld: false, excerptsLimited: limited,
  };
  return { session, filename };
}

/** A session whose excerpts fail the display schema keeps its status, placement and counts; only its wording is withheld. */
function validated(session: DebugSession): DebugSession | null {
  if (DebugSessionSchema.safeParse(session).success) return session;
  const withheld: DebugSession = { ...session, title: null, recordedStatus: null, ...Object.fromEntries(detailKeys.map((key) => [key, null])), excerptsLimited: true };
  return DebugSessionSchema.safeParse(withheld).success ? withheld : null;
}

/** Project the read-only GSD debug register: the active directory and its resolved archive. File keys and raw text never reach the DTO. */
export function buildDebug(inventory: AllowedInventory): BoardDebug {
  if (!inventory.available) return unavailable(inventory.limited);
  const counts = emptyCounts();
  const problems = inventory.problems.filter((problem) => problem.kind === "debug");
  const unresolvedProblems = problems.filter((problem) => problem.warning !== "absent");
  const files = (inventory.debugArtifacts ?? []).map(candidate).filter((item): item is Candidate => item !== null);
  const watched = inventory.watchDirectories ?? [];
  const directoryState = watched.includes("debug") || files.length ? "observed" : problems.some((problem) => problem.warning === "absent") ? "absent" : "unknown";
  const archiveState = watched.includes("debug/resolved") || files.some((file) => file.location === "archived") ? "observed"
    : directoryState === "absent" || (directoryState === "observed" && !unresolvedProblems.length) ? "absent" : "unknown";
  // Reader failures have no filenames, so totals describe enumerated files only.
  const countsComplete = !unresolvedProblems.length && directoryState !== "unknown";
  let limited = !countsComplete;
  counts.unavailable = Math.min(maxCount, unresolvedProblems.length);
  const parsed: Parsed[] = [];
  // The same name in both locations is two records of one session, even when one of them cannot be read; neither is preferred.
  const locationsBySlug = new Map<string, Set<DebugLocation>>();
  for (const file of files) {
    let result: ReturnType<typeof parse>;
    try { result = parse(file); } catch { result = null; }
    if (result === "knowledge-base") { counts.knowledgeBase = addCount(counts.knowledgeBase); continue; }
    if (result === "note") { counts.notes = addCount(counts.notes); continue; }
    counts[file.location] = addCount(counts[file.location]);
    const key = file.filename.toLowerCase();
    locationsBySlug.set(key, (locationsBySlug.get(key) ?? new Set()).add(file.location));
    const session = result && validated(result.session);
    if (!result || !session) { counts.unavailable = addCount(counts.unavailable); limited = true; continue; }
    parsed.push({ session, filename: result.filename });
  }
  for (const entry of parsed) if ((locationsBySlug.get(entry.filename.toLowerCase())?.size ?? 0) > 1) entry.session = { ...entry.session, notes: [...entry.session.notes, "duplicate-slug"] };
  for (const { session } of parsed) {
    const kind = session.statusKind;
    if (kind === "open") counts.open = addCount(counts.open);
    else if (kind === "diagnosed") counts.diagnosed = addCount(counts.diagnosed);
    else if (kind === "awaiting-verification") counts.awaitingVerification = addCount(counts.awaitingVerification);
    else if (kind === "blocked") counts.blocked = addCount(counts.blocked);
    else if (kind === "resolved") counts.resolved = addCount(counts.resolved);
    else counts.unclassified = addCount(counts.unclassified);
    // Unresolved means a recorded status that is not resolved; unclassified and unrecorded statuses are counted apart.
    if (kind === "open" || kind === "diagnosed" || kind === "awaiting-verification" || kind === "blocked") counts.unresolved = addCount(counts.unresolved);
    if (session.notes.length) counts.reconciliation = addCount(counts.reconciliation);
    if (kind !== "resolved" || session.notes.length) counts.attention = addCount(counts.attention);
  }
  const recency = (session: DebugSession) => session.updatedAt ?? session.resolvedAt ?? session.createdAt ?? "";
  parsed.sort((left, right) => rank[left.session.statusKind] - rank[right.session.statusKind]
    || (left.session.location === right.session.location ? 0 : left.session.location === "active" ? -1 : 1)
    || recency(right.session).localeCompare(recency(left.session)) || left.filename.localeCompare(right.filename));
  let detailCharacters = 0;
  const sessions = parsed.slice(0, maxSessions).map(({ session }) => {
    const size = detailKeys.reduce((total, key) => total + (session[key]?.length ?? 0), 0);
    if (detailCharacters + size <= maxDetailCharacters) { detailCharacters += size; return session; }
    limited = true;
    return { ...session, ...Object.fromEntries(detailKeys.map((key) => [key, null])), detailsWithheld: true } as DebugSession;
  });
  if (parsed.length > maxSessions) limited = true;
  counts.displayed = sessions.length;
  const board: BoardDebug = { availability: "available", directoryState, archiveState, sessions, counts, countsComplete, limited };
  return BoardDebugSchema.safeParse(board).success ? board : unavailable(true);
}

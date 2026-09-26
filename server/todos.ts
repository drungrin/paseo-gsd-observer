import { BoardTodosSchema, TodoItemSchema, TODO_IMPORTANCE, type BoardTodos, type TodoDirectory, type TodoItem } from "../shared/todos.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { atxHeading, date, decodeDocument, excerpt, frontmatter, leadExcerpt, normalize } from "./document-text.js";

const maxItems = 64;
const maxSummaryCharacters = 4096;
const maxCount = 100_000;
// At most two dots: an IPv4 address cannot masquerade as a phase identifier.
const phasePattern = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/;
const names: ReadonlySet<string> = new Set(TODO_IMPORTANCE);
const emptyCounts = (): BoardTodos["counts"] => ({ pending: 0, backlog: 0, deferred: 0, done: 0, completed: 0, root: 0,
  totalFiles: 0, distinctTasks: 0, unavailable: 0, duplicates: 0, conflicts: 0, displayed: 0 });
const addCount = (count: number, increment = 1) => Math.min(maxCount, count + increment);

type Candidate = { artifact: AllowedArtifact; directory: TodoDirectory; filename: string };
type Parsed = { item: TodoItem; filename: string };

/** Only the reader's TODO namespace, never a phase or an archived file. The name is used internally for collision counts, never displayed. */
function candidate(artifact: AllowedArtifact): Candidate | null {
  if (artifact.kind !== "todo" || artifact.phaseId) return null;
  const match = /^todos\/(?:(pending|backlog|deferred|done|completed)\/)?([^/\\]+\.md)$/i.exec(artifact.key);
  return match ? { artifact, directory: (match[1]?.toLowerCase() ?? "root") as TodoDirectory, filename: match[2] } : null;
}

function lifecycle(directory: TodoDirectory): TodoItem["lifecycle"] {
  return directory === "pending" ? "pending" : directory === "backlog" || directory === "deferred" ? "backlog"
    : directory === "root" ? "root-unclassified" : "completed";
}

function status(raw: string | null | undefined): TodoItem["recordedStatus"] {
  if (!raw) return null;
  const value = normalize(raw).replace(/[_\s]+/g, "-");
  if (/^(?:open|pending|pendente|aberto|ativa|ativo)(?:$|\b)/.test(value)) return "open";
  if (/^(?:risco-aceito|risk-accepted)(?:$|\b)/.test(value)) return "risk-accepted";
  if (/^(?:deferred|diferido|adiado|backlog)(?:$|\b)/.test(value)) return "deferred";
  if (/^(?:done|completed|complete|closed|resolved|concluido|concluida|resolvido|resolvida|fechado)(?:$|\b)/.test(value)) return "done";
  return "other";
}

function importance(value: string | null | undefined): TodoItem["severity"] {
  const word = value && normalize(value).trim().toLowerCase();
  return word && names.has(word) ? word as TodoItem["severity"] : null;
}

/** Scan Markdown structure once. Fenced examples never supply headings, status or prose; an unclosed fence invalidates the item. */
function bodyEvidence(body: string): { heading: string | null; explicitStatus: string | null; problem: string | null } | null {
  let fence: { marker: string; length: number } | null = null;
  let heading: string | null = null;
  let explicitStatus: string | null = null;
  let problem: string | null = null;
  let inProblem = false;
  let pastIntro = false;
  const paragraph: string[] = [];
  for (const line of body.split("\n")) {
    if (line.length > 16_384) return null;
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
    if (fence) {
      if (closing && closing[0] === fence.marker && closing.length >= fence.length) fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (opening) {
      if (inProblem && paragraph.length) { problem = paragraph.join(" "); inProblem = false; }
      fence = { marker: opening[0], length: opening.length };
      continue;
    }
    const section = atxHeading(line, 0);
    if (section) {
      if (inProblem && paragraph.length) problem = paragraph.join(" ");
      if (section.level === 1 && heading === null) heading = section.text;
      if (section.level === 2) {
        pastIntro = true;
        inProblem = problem === null && /^(?:problem|problema|issue|questao)$/.test(normalize(section.text));
      } else inProblem = false;
      continue;
    }
    if (!pastIntro && explicitStatus === null) explicitStatus = /^\*\*(?:estado|status):\*\*\s*(.+)$/i.exec(line)?.[1] ?? null;
    if (!inProblem) continue;
    const trimmed = line.trim();
    if (!trimmed || /^(?:[-*]\s|\d+\.\s|>|\|)/.test(trimmed)) {
      if (paragraph.length) { problem = paragraph.join(" "); inProblem = false; }
      continue;
    }
    paragraph.push(trimmed);
    if (paragraph.join(" ").length > 1600) { problem = paragraph.join(" "); inProblem = false; }
  }
  if (fence) return null;
  if (problem === null && paragraph.length) problem = paragraph.join(" ");
  return { heading, explicitStatus, problem };
}

function parse(candidate: Candidate): Parsed | null {
  const { artifact, directory, filename } = candidate;
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return null;
  const text = decodeDocument(artifact.bytes);
  if (!text || text.includes("\0")) return null;
  const matter = frontmatter(text);
  if (!matter) return null;
  const fields = matter.values;
  // frontmatter() marks repeated keys null; a repeated status is ambiguous, not an absent status.
  if (fields.has("status") && fields.get("status") === null) return null;
  const evidence = bodyEvidence(matter.body);
  if (!evidence) return null;
  const { heading } = evidence;
  // Root files are not presumed open based on narrative prose. Only explicit metadata or a status heading counts.
  const explicit = fields.get("status") ?? evidence.explicitStatus;
  const headingStatus = /^(deferred|diferido)(?:\s*[—–:-]\s*.+)?$/i.exec(heading ?? "")?.[1];
  const recordedStatus = status(explicit ?? headingStatus);
  const observed = lifecycle(directory);
  const statusConflict = recordedStatus !== null && recordedStatus !== "other" && (
    observed === "completed" ? recordedStatus !== "done" : observed === "pending" ? recordedStatus !== "open"
      : observed === "backlog" ? recordedStatus !== "deferred" && recordedStatus !== "risk-accepted" : false);
  const phase = fields.get("resolves_phase")?.trim() ?? "";
  const area = fields.get("area");
  const safeArea = area && /^[\p{L}][\p{L}\p{N} -]{0,63}$/u.test(area) ? excerpt(area, 64) : null;
  const metadataTitle = excerpt(fields.get("title"), 200);
  const safeTitle = metadataTitle && !metadataTitle.includes("[omitted]") ? metadataTitle : excerpt(heading, 200);
  const item: TodoItem = {
    directory, lifecycle: observed, recordedStatus, statusConflict, duplicateName: false,
    title: safeTitle,
    summary: evidence.problem ? leadExcerpt(evidence.problem, 320).text : null,
    area: safeArea && !safeArea.includes("[omitted]") ? safeArea : null,
    createdAt: date(fields.get("created") ?? fields.get("criado")),
    completedAt: date(fields.get("completed") ?? fields.get("closed") ?? fields.get("resolved")),
    phaseId: phase.length <= 64 && phasePattern.test(phase) ? phase : null,
    severity: importance(fields.get("severity")), priority: importance(fields.get("priority")),
  };
  return { item, filename };
}

/** Project a project-wide read-only TODO register. File keys and raw source text are never part of the DTO. */
export function buildTodos(inventory: AllowedInventory): BoardTodos {
  const counts = emptyCounts();
  if (!inventory.available) return { availability: "unavailable", directoryState: "unknown", items: [], counts, countsComplete: false, limited: inventory.limited };

  const problems = inventory.problems.filter((problem) => problem.kind === "todo");
  const files = inventory.artifacts.map(candidate).filter((item): item is Candidate => item !== null);
  const absent = problems.some((problem) => problem.warning === "absent");
  const observed = files.length > 0 || inventory.watchDirectories?.some((path) => path === "todos" || path.startsWith("todos/"));
  const directoryState = observed ? "observed" : absent ? "absent" : "unknown";
  counts.unavailable = Math.min(maxCount, problems.filter((problem) => problem.warning !== "absent").length);
  // Reader failures have no filenames, so totals describe enumerated artifacts only.
  const countsComplete = !problems.some((problem) => problem.warning !== "absent") && (directoryState !== "unknown" || files.length > 0);
  let limited = !countsComplete;
  const parsed: Parsed[] = [];
  const directoriesByName = new Map<string, Set<TodoDirectory>>();
  for (const file of files) {
    counts[file.directory] = addCount(counts[file.directory]);
    counts.totalFiles = addCount(counts.totalFiles);
    const directories = directoriesByName.get(file.filename) ?? new Set<TodoDirectory>();
    directories.add(file.directory);
    directoriesByName.set(file.filename, directories);
    try {
      const result = parse(file);
      if (!result || !TodoItemSchema.safeParse(result.item).success) { counts.unavailable = addCount(counts.unavailable); limited = true; continue; }
      if (result.item.statusConflict) counts.conflicts = addCount(counts.conflicts);
      parsed.push(result);
    } catch { counts.unavailable = addCount(counts.unavailable); limited = true; }
  }
  counts.distinctTasks = Math.min(maxCount, directoriesByName.size);
  const duplicates = new Set([...directoriesByName].filter(([, directories]) => directories.size > 1).map(([name]) => name));
  counts.duplicates = Math.min(maxCount, [...directoriesByName].reduce((total, [name, directories]) => total + (duplicates.has(name) ? directories.size : 0), 0));
  // Open and recorded at-risk work precedes history, regardless of reader enumeration order.
  const rank = (item: TodoItem) => item.lifecycle === "completed" ? item.statusConflict ? 5 : 6
    : item.statusConflict ? 0
    : item.severity === "blocker" || item.severity === "critical" || item.priority === "blocker" || item.priority === "critical" ? 1
      : item.lifecycle === "pending" ? 2 : item.lifecycle === "backlog" ? 3 : 4;
  parsed.sort((left, right) => rank(left.item) - rank(right.item) || (right.item.createdAt ?? "").localeCompare(left.item.createdAt ?? "") || left.filename.localeCompare(right.filename));
  let summaryCharacters = 0;
  const items = parsed.slice(0, maxItems).map(({ item, filename }) => {
    const summary = item.summary;
    if (summary && summaryCharacters + summary.length > maxSummaryCharacters) { limited = true; return { ...item, summary: null, duplicateName: duplicates.has(filename) }; }
    summaryCharacters += summary?.length ?? 0;
    return { ...item, duplicateName: duplicates.has(filename) };
  });
  if (parsed.length > maxItems) limited = true;
  counts.displayed = items.length;
  const board: BoardTodos = { availability: "available", directoryState, items, counts, countsComplete, limited };
  if (BoardTodosSchema.safeParse(board).success) return board;
  return { availability: "unavailable", directoryState: "unknown", items: [], counts: emptyCounts(), countsComplete: false, limited: true };
}

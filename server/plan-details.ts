export type PlanDetails = {
  type?: string;
  wave?: number;
  dependsOn: string[];
  requirements: string[];
  objective?: { statement?: string; purpose?: string; output?: string };
  truths: string[];
  guardrails: Array<{ statement: string; status?: string }>;
  taskCount: number;
  checkpointCount: number;
  blockingHumanCount: number;
  successCriteria: string[];
  plannedOutputs: string[];
  summary: { exists: boolean; status?: string; outcome?: string; requires: string[]; provides: string[]; affects: string[]; actuals?: { tokens?: number; tasks?: number; commits?: number }; duration?: string; completed?: string; decisions: string[]; deviations?: string; issues?: string; nextReadiness?: string; observedChangeCount: number };
};

const MAX_TEXT = 640;
const MAX_ITEMS = 8;
const safe = (value: string, max = MAX_TEXT) => {
  const normalized = value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max || /(?:https?:\/\/|\b(?:secret|token|password|api[_-]?key|authorization|bearer)\b|AKIA[0-9A-Z]{16})/i.test(normalized)) return undefined;
  return normalized.replace(/[<>]/g, "");
};

const unquote = (value: string) => value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
const frontmatter = (text: string) => {
  const normalized = text.replace(/\r\n?/g, "\n");
  const end = normalized.startsWith("---\n") ? normalized.indexOf("\n---\n", 4) : -1;
  return end < 0 ? { front: "", body: normalized } : { front: normalized.slice(4, end), body: normalized.slice(end + 5) };
};
const scalar = (front: string, key: string, maxLength = 128) => {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front);
  return match ? safe(unquote(match[1]), maxLength) : undefined;
};
const numeric = (front: string, key: string) => {
  const value = scalar(front, key);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
};
const list = (front: string, key: string, indent = 0, maxLength = 240) => {
  const lines = front.split("\n"); const start = lines.findIndex((line) => new RegExp(`^ {${indent}}${key}:\\s*(?:$|\\[)`).test(line));
  if (start < 0) return [];
  const inline = /^\s*[A-Za-z_-]+:\s*\[(.*)\]\s*$/.exec(lines[start])?.[1];
  if (inline !== undefined) return inline.split(",").map(unquote).map((value) => safe(value, maxLength)).filter((value): value is string => Boolean(value)).slice(0, MAX_ITEMS);
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) || new RegExp(`^ {0,${indent}}[A-Za-z_-]+:`).test(lines[index])) break;
    const item = /^\s*-\s+(.+)$/.exec(lines[index])?.[1];
    if (item) { const value = safe(unquote(item), maxLength); if (value) result.push(value); }
  }
  return result.slice(0, MAX_ITEMS);
};
const nestedList = (front: string, parent: string, key: string) => {
  const lines = front.split("\n"); const parentAt = lines.findIndex((line) => new RegExp(`^${parent}:\\s*$`).test(line));
  if (parentAt < 0) return [];
  const start = lines.findIndex((line, index) => index > parentAt && /^  [A-Za-z_-]+:/.test(line) && line.trimStart().startsWith(`${key}:`));
  if (start < 0) return [];
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_-]+:/.test(lines[index]) || /^\S/.test(lines[index])) break;
    const item = /^\s*-\s+(.+)$/.exec(lines[index])?.[1];
    if (item) { const value = safe(unquote(item), 240); if (value) result.push(value); }
  }
  return result.slice(0, MAX_ITEMS);
};
const nestedScalar = (front: string, parent: string, key: string) => {
  const lines = front.split("\n"); const parentAt = lines.findIndex((line) => new RegExp(`^${parent}:\\s*$`).test(line));
  if (parentAt < 0) return undefined;
  const match = lines.slice(parentAt + 1).find((line) => new RegExp(`^  ${key}:\\s*(.+)$`).test(line));
  return match ? safe(unquote(new RegExp(`^  ${key}:\\s*(.+)$`).exec(match)![1]), 128) : undefined;
};
const nestedNumeric = (front: string, parent: string, key: string) => {
  const value = nestedScalar(front, parent, key);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
};
const recordValues = (front: string, parent: string, key: string, field: string) => {
  const lines = front.split("\n"); const parentAt = lines.findIndex((line) => new RegExp(`^${parent}:\\s*$`).test(line));
  if (parentAt < 0) return [];
  const start = lines.findIndex((line, index) => index > parentAt && line === `  ${key}:`);
  if (start < 0) return [];
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_-]+:/.test(lines[index]) || /^\S/.test(lines[index])) break;
    const inline = new RegExp(`^    - ${field}:\\s*(.+)$`).exec(lines[index])?.[1];
    const nested = new RegExp(`^      ${field}:\\s*(.+)$`).exec(lines[index])?.[1];
    const value = inline ?? nested;
    if (value) { const safeValue = safe(unquote(value), 240); if (safeValue) values.push(safeValue); }
  }
  return values.slice(0, MAX_ITEMS);
};
const section = (body: string, heading: string) => {
  const match = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\s*$)`, "mi").exec(body);
  return match ? safe(match[1]) : undefined;
};
const tag = (body: string, name: string) => new RegExp(`<${name}>\\s*([\\s\\S]{0,8192}?)\\s*</${name}>`, "i").exec(body)?.[1];

export function parsePlanDetails(planMarkdown: string, summaryMarkdown?: string): PlanDetails {
  const plan = frontmatter(planMarkdown);
  const objectiveText = tag(plan.body, "objective");
  const objectiveLines = objectiveText?.split("\n") ?? [];
  const purpose = objectiveLines.find((line) => /^Purpose:\s*/.test(line));
  const output = objectiveLines.find((line) => /^Output:\s*/.test(line));
  const statement = safe(objectiveLines.filter((line) => line.trim() && !/^(Purpose|Output):\s*/.test(line)).join(" "));
  const prohibitions = recordValues(plan.front, "must_haves", "prohibitions", "statement");
  const guardrails = prohibitions.map((statement) => ({ statement }));
  const taskBlocks = [...plan.body.matchAll(/<task\b([^>]*)>([\s\S]*?)<\/task>/gi)];
  const successCriteria = (tag(plan.body, "success_criteria") ?? "").split("\n").map((line) => /^\s*-\s+(.+)$/.exec(line)?.[1]).flatMap((value) => value ? [safe(value, 240)] : []).filter((value): value is string => Boolean(value)).slice(0, MAX_ITEMS);
  const summary = summaryMarkdown ? frontmatter(summaryMarkdown) : undefined;
  const summaryOutcome = summary ? /^\s*\*\*(.+)\*\*\s*$/m.exec(summary.body)?.[1] : undefined;
  const keyFileCount = summary ? list(summary.front, "created", 2).length + list(summary.front, "modified", 2).length : 0;
  return {
    ...(scalar(plan.front, "type", 64) ? { type: scalar(plan.front, "type", 64) } : {}), ...(numeric(plan.front, "wave") ? { wave: numeric(plan.front, "wave") } : {}),
    dependsOn: list(plan.front, "depends_on", 0, 128), requirements: list(plan.front, "requirements", 0, 128),
    ...(statement || purpose || output ? { objective: { ...(statement ? { statement } : {}), ...(purpose ? { purpose: safe(purpose.replace(/^Purpose:\s*/, "")) } : {}), ...(output ? { output: safe(output.replace(/^Output:\s*/, "")) } : {}) } } : {}),
    truths: nestedList(plan.front, "must_haves", "truths"), guardrails, taskCount: taskBlocks.length,
    checkpointCount: taskBlocks.filter((block) => /type\s*=\s*["']checkpoint:/.test(block[1])).length,
    blockingHumanCount: taskBlocks.filter((block) => /gate\s*=\s*["']blocking-human/.test(block[1])).length,
    successCriteria, plannedOutputs: recordValues(plan.front, "must_haves", "artifacts", "provides"),
    summary: summary ? { exists: true, ...(scalar(summary.front, "status", 64) ? { status: scalar(summary.front, "status", 64) } : {}), ...(summaryOutcome ? { outcome: safe(summaryOutcome) } : {}), requires: list(summary.front, "requires"), provides: list(summary.front, "provides"), affects: list(summary.front, "affects"), ...(nestedNumeric(summary.front, "actuals", "tokens") || nestedNumeric(summary.front, "actuals", "tasks") || nestedNumeric(summary.front, "actuals", "commits") ? { actuals: { ...(nestedNumeric(summary.front, "actuals", "tokens") ? { tokens: nestedNumeric(summary.front, "actuals", "tokens") } : {}), ...(nestedNumeric(summary.front, "actuals", "tasks") ? { tasks: nestedNumeric(summary.front, "actuals", "tasks") } : {}), ...(nestedNumeric(summary.front, "actuals", "commits") ? { commits: nestedNumeric(summary.front, "actuals", "commits") } : {}) } } : {}), ...(scalar(summary.front, "duration", 64) ? { duration: scalar(summary.front, "duration", 64) } : {}), ...(scalar(summary.front, "completed", 64) ? { completed: scalar(summary.front, "completed", 64) } : {}), decisions: list(summary.front, "key-decisions"), ...(section(summary.body, "Deviations from Plan") ? { deviations: section(summary.body, "Deviations from Plan") } : {}), ...(section(summary.body, "Issues Encountered") ? { issues: section(summary.body, "Issues Encountered") } : {}), ...(section(summary.body, "Next Phase Readiness") ? { nextReadiness: section(summary.body, "Next Phase Readiness") } : {}), observedChangeCount: keyFileCount } : { exists: false, requires: [], provides: [], affects: [], decisions: [], observedChangeCount: 0 },
  };
}

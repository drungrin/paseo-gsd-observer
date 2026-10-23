import { PathQuestionSchema, PathQuestionsSchema, type PathQuestion, type PathQuestions, type PathWarning } from "../shared/path.js";
import type { AllowedInventory } from "./allowed-reader.js";
import { datePattern, headings, pathDocument, proseLines, shortExcerpt, token, withoutComments } from "./path-text.js";

/**
 * Discussion records in `discuss/ANSWERS.md`. An answer is pending, as the GSD Path daemon reads it, when its follow-up is
 * required, its status is final or NEEDS-USER, and no disposition names it. An answer a later one supersedes is closed too.
 */

const answerHeading = /^Answer\s+(A\d{3,6})\b(.*)$/;
const dispositionHeading = /^Disposition\s+X\d{3,6}\b/;
const field = /^-\s+\*\*([^*]{1,64})\*\*:\s*(.*)$/;
const answerId = /^A\d{3,6}$/;
const maxPending = 128;
// The daemon's exact values: a differently cased status or follow-up is not the recorded state.
const awaiting = new Set(["final", "NEEDS-USER"]);

export const emptyQuestions = (availability: PathQuestions["availability"]): PathQuestions => ({ availability, pending: [], counts: { answers: 0, pending: 0, closed: 0 }, limited: false });

const fields = (lines: readonly string[]) => {
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = field.exec(line.trim());
    if (match && !values.has(match[1].trim().toLowerCase())) values.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return values;
};
const recorded = (value: string | undefined) => value && !/^none$/i.test(value) ? value : null;

export function buildQuestions(inventory: AllowedInventory, warnings: Set<PathWarning>): PathQuestions {
  const document = inventory.artifacts.find((item) => item.kind === "path-answers");
  if (!document) {
    if (!inventory.problems.some((item) => item.kind === "path-answers")) return emptyQuestions("absent");
    warnings.add("questions-unavailable");
    return emptyQuestions("unavailable");
  }
  const text = pathDocument(document.bytes);
  const lines = text === null ? null : proseLines(withoutComments(text));
  if (!lines) { warnings.add("questions-malformed"); return emptyQuestions("unavailable"); }
  const answers: { id: string; rest: string; values: Map<string, string> }[] = [];
  const closed = new Set<string>();
  for (const section of headings(lines, 2)) {
    const answer = answerHeading.exec(section.heading);
    const values = fields(section.lines);
    if (answer) {
      answers.push({ id: answer[1], rest: answer[2], values });
      const supersedes = values.get("supersedes");
      if (supersedes && answerId.test(supersedes)) closed.add(supersedes);
    } else if (dispositionHeading.test(section.heading)) {
      const target = values.get("answer");
      if (target && answerId.test(target)) closed.add(target);
    }
  }
  const pending: PathQuestion[] = [];
  for (const { id, rest, values } of answers) {
    if (closed.has(id) || values.get("follow-up") !== "required" || !awaiting.has(values.get("status") ?? "")) continue;
    // "## Answer A001 — 2026-10-01 — topic"
    const [date, ...topic] = rest.replace(/^\s*[—–-]\s*/, "").split(/\s+[—–-]\s+/);
    const question: PathQuestion = {
      id, date: datePattern.test(date?.trim() ?? "") ? date.trim() : null, topic: shortExcerpt(topic.join(" — "), 200).text,
      question: shortExcerpt(values.get("question"), 400).text, status: token(values.get("status")),
      owner: shortExcerpt(recorded(values.get("next owner")), 120).text, target: shortExcerpt(recorded(values.get("target artifact")), 200).text,
    };
    if (PathQuestionSchema.safeParse(question).success) pending.push(question);
    else { warnings.add("questions-malformed"); pending.push({ ...question, topic: null, question: null, owner: null, target: null }); }
  }
  const questions: PathQuestions = {
    availability: "available", pending: pending.slice(0, maxPending),
    counts: { answers: Math.min(answers.length, 100_000), pending: Math.min(pending.length, 100_000), closed: Math.min(answers.filter((answer) => closed.has(answer.id)).length, 100_000) },
    limited: pending.length > maxPending,
  };
  return PathQuestionsSchema.safeParse(questions).success ? questions : { ...emptyQuestions("unavailable"), limited: true };
}

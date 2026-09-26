import { describe, expect, it } from "vitest";
import { buildTodos } from "../../server/todos";
import type { AllowedInventory } from "../../server/allowed-reader";
import { BoardTodosSchema } from "../../shared/todos";

const file = (directory: string, filename: string, text: string, size = Buffer.byteLength(text)) => ({
  key: `todos/${directory ? `${directory}/` : ""}${filename}`, kind: "todo" as const, bytes: Buffer.from(text), size,
});
const inventory = (artifacts: AllowedInventory["artifacts"] = [], changes: Partial<AllowedInventory> = {}): AllowedInventory => ({
  available: true, artifacts, problems: [], warnings: [], limited: false, watchDirectories: ["todos"], ...changes,
});

const mabilisPending = `---
created: 2026-08-10T20:05:00.000Z
title: Encaixe de estado vazio no MabilisGrid
area: client
severity: minor
files:
  - src/Mabilis.Client/Components/Grids/MabilisGrid.razor:73
---

## Problem

A grade precisa de uma mensagem específica do domínio.

## Solution

Alterar o wrapper sem mudar o padrão.
`;
const mabilisBacklog = `---
created: 2026-08-11T10:55:00.000Z
title: Rotacionar as credenciais commitadas
area: security
priority: critical
files:
  - repo/src/Mabilis.Legis/appsettings.json
---

## Problem

Segredos foram expostos e precisam de rotação.
`;
const mabilisDone = `---
status: done
created: 2026-07-18
resolved: 2026-07-27
source: 31-REVIEW.md CR-01
severity: warning
area: mabilis/src/Mabilis.Legis/Program.cs
---

# Legis host: dependency registration missing

## Problem

O host omite um serviço obrigatório.
`;
const amoldaPending = `---
tipo: todo
area: legal
criado: 2026-08-13
origem: gap identificado em 07-VERIFICATION.md
resolves_phase: 7.2
files:
  - apps/web/src/app/termos/page.tsx
---

# Revisar copy jurídica provisória

As páginas permanecem provisórias.
`;
const amoldaCompleted = `---
created: 2026-08-18T00:00:00.000Z
title: Investigar flake sob execução concorrente
area: test
---

## Problem

O caso falhou uma vez durante a rodada inteira.
`;
const cronappRoot = `# Diferido — validação de PR própria

**Estado:** diferido fora do marco vertical de login.

## Motivo

A definição não é infraestrutura indispensável.
`;

const project = (...files: ReturnType<typeof file>[]) => buildTodos(inventory(files));

describe("project-wide TODO register", () => {
  it("projects real-shaped Mabilis, amolda and Cronapp files without phase-plan coupling", () => {
    const result = project(
      file("pending", "mabilis-pending.md", mabilisPending), file("backlog", "mabilis-backlog.md", mabilisBacklog),
      file("done", "mabilis-done.md", mabilisDone), file("pending", "amolda-pending.md", amoldaPending),
      file("completed", "amolda-completed.md", amoldaCompleted), file("", "ci-validacao-pr.md", cronappRoot),
      file("deferred", "deferred-work.md", "---\nstatus: risco-aceito\npriority: high\n---\n# Revisit accepted risk\n"),
    );
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
    expect(result.directoryState).toBe("observed");
    expect(result.countsComplete).toBe(true);
    expect(result.counts).toMatchObject({ pending: 2, backlog: 1, deferred: 1, done: 1, completed: 1, root: 1, totalFiles: 7, distinctTasks: 7, unavailable: 0, displayed: 7, conflicts: 0 });
    const pending = result.items.find((item) => item.title === "Encaixe de estado vazio no MabilisGrid");
    expect(pending).toMatchObject({ directory: "pending", lifecycle: "pending", recordedStatus: null, severity: "minor", priority: null, area: "client", createdAt: "2026-08-10", summary: "A grade precisa de uma mensagem específica do domínio." });
    expect(result.items.find((item) => item.title === "Revisar copy jurídica provisória")).toMatchObject({ phaseId: "7.2", createdAt: "2026-08-13", area: "legal", summary: null });
    expect(result.items.find((item) => item.directory === "done")).toMatchObject({ recordedStatus: "done", completedAt: "2026-07-27", area: null });
    expect(result.items.find((item) => item.directory === "root")).toMatchObject({ recordedStatus: "deferred", lifecycle: "root-unclassified" });
    expect(result.items.find((item) => item.directory === "deferred")).toMatchObject({ lifecycle: "backlog", recordedStatus: "risk-accepted" });
  });

  it("counts physical files and unique filename keys separately, flagging cross-folder collisions without leaking filenames", () => {
    const result = project(file("pending", "duplicate-name.md", mabilisPending), file("backlog", "duplicate-name.md", mabilisBacklog), file("done", "unique.md", mabilisDone));
    expect(result.counts).toMatchObject({ totalFiles: 3, distinctTasks: 2, duplicates: 2, displayed: 3 });
    expect(result.items.filter((item) => item.duplicateName)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("duplicate-name.md");
    expect(JSON.stringify(result)).not.toContain("unique.md");
  });

  it("does not infer root pending or deferred status from incidental prose", () => {
    const result = project(file("", "floating.md", "# Separate work\n\nThis might be deferred eventually, pending a decision.\n"));
    expect(result.items[0]).toMatchObject({ directory: "root", lifecycle: "root-unclassified", recordedStatus: null, statusConflict: false });
    expect(project(file("", "explicit.md", "# Diferido — outro assunto\n\nO corpo não altera o estado.\n")).items[0].recordedStatus).toBe("deferred");
  });

  it("reports status/directories conflicts independently of lifecycle and keeps severity distinct from priority", () => {
    const result = project(file("pending", "conflicting.md", "---\nstatus: done\nseverity: high\npriority: medium\nresolves_phase: 59.1-x\n---\n# Investigate behavior\n"),
      file("done", "reopened.md", "---\nstatus: deferred\n---\n# Reopened item\n"));
    expect(result.counts.conflicts).toBe(2);
    expect(result.items.find((item) => item.directory === "pending")).toMatchObject({ lifecycle: "pending", recordedStatus: "done", statusConflict: true, severity: "high", priority: "medium", phaseId: null });
  });

  it("never publishes metadata paths, commands, credentials, filenames or unsafe body text", () => {
    const text = `---\ncreated: 2026-08-20\ntitle: Investigate src/private/config.ts and token: ghp_abcdefghijklmnopqrstuvwxyz012345\narea: src/private/config.ts\nseverity: urgent\npriority: low\nsource: internal/users/jane.md\nresolves_phase: ../../secrets\n---\n# Good fallback heading\n\n## Problem\n\nRun npm install secret-package at http://localhost:8000 before changing src/private/config.ts.\n\n## Solution\n\nBearer abcdefghijklmnopqrstuvwxyz123456 secret: OPEN-SESAME\n`;
    const result = project(file("backlog", "ghp_abcdefghijklmnopqrstuvwxyz012345.md", text));
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
    expect(result.items[0]).toMatchObject({ title: "Good fallback heading", area: null, severity: null, priority: "low", phaseId: null });
    const output = JSON.stringify(result);
    for (const canary of ["src/private", "config.ts", "localhost", "8000", "ghp_", "OPEN-SESAME", "internal/users", "npm install", "../../secrets"]) expect(output).not.toContain(canary);
  });

  it("isolates malformed, oversized and unreadable items without failing the board", () => {
    const invalidUtf8 = { ...file("pending", "invalid.md", "x"), bytes: Buffer.from([0xff]) };
    const result = buildTodos(inventory([
      file("pending", "okay.md", mabilisPending), file("pending", "unclosed.md", "---\ntitle: bad\n"),
      file("backlog", "oversize.md", "# Too big", 256 * 1024 + 1), invalidUtf8,
    ], { problems: [{ kind: "todo", warning: "unreadable" }, { kind: "todo", warning: "oversize" }] }));
    expect(result).toMatchObject({ availability: "available", countsComplete: false, limited: true, counts: { totalFiles: 4, displayed: 1, unavailable: 5 } });
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
  });

  it("keeps counts for every file beyond display and summary caps, selecting open and at-risk work first", () => {
    const many = Array.from({ length: 90 }, (_, index) => file(index < 78 ? "completed" : "pending", `task-${String(index).padStart(3, "0")}.md`, `---\ntitle: Task ${index}\nseverity: ${index === 0 || index === 89 ? "critical" : "low"}\n---\n## Problem\n\n${"This is a public description of this recorded item. ".repeat(8)}\n`));
    const result = project(...many);
    expect(result.counts).toMatchObject({ totalFiles: 90, distinctTasks: 90, completed: 78, pending: 12, displayed: 64 });
    expect(result.items[0].title).toBe("Task 89");
    expect(result.items.filter((item) => item.lifecycle === "pending")).toHaveLength(12);
    expect(result.limited).toBe(true);
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
  });

  it("distinguishes an absent TODO directory from an empty observed directory or an unavailable workspace", () => {
    expect(buildTodos(inventory([], { watchDirectories: [], problems: [{ kind: "todo", warning: "absent" }] }))).toMatchObject({ availability: "available", directoryState: "absent", items: [], limited: false });
    expect(buildTodos(inventory())).toMatchObject({ availability: "available", directoryState: "observed", items: [], limited: false });
    expect(buildTodos(inventory([], { available: false }))).toMatchObject({ availability: "unavailable", directoryState: "unknown" });
  });

  it("never mistakes an IPv4 address for a related phase, in either projection or schema", () => {
    const result = project(file("pending", "network.md", "---\nresolves_phase: 192.168.1.1\n---\n# Network review\n"));
    expect(result.items[0].phaseId).toBeNull();
    expect(BoardTodosSchema.safeParse({ ...result, items: [{ ...result.items[0], phaseId: "192.168.1.1" }] }).success).toBe(false);
    expect(project(file("pending", "phase.md", "---\nresolves_phase: 59.1.2\n---\n# Phase review\n")).items[0].phaseId).toBe("59.1.2");
  });

  it("ignores headings, status and paragraphs inside fenced examples and fails closed on unclosed fences", () => {
    const fenced = "```md\n# Diferido — fake heading\n**Estado:** done\n## Problem\nSecret example text\n```\n# Actual title\n\n## Problem\n\nA real public issue needs review.\n";
    const result = project(file("", "examples.md", fenced));
    expect(result.items[0]).toMatchObject({ title: "Actual title", recordedStatus: null, summary: "A real public issue needs review." });
    expect(JSON.stringify(result)).not.toContain("Secret example text");
    const split = project(file("pending", "split.md", "## Problem\n\nFirst public paragraph.\n```md\nSecret example text\n```\nSecond public paragraph.\n"));
    expect(split.items[0].summary).toBe("First public paragraph.");
    const fakeOnly = project(file("", "fence-only.md", "~~~markdown\n# Diferido — fenced status\n## Problem\nSecret example text\n~~~\n"));
    expect(fakeOnly.items[0]).toMatchObject({ title: null, recordedStatus: null, summary: null });
    const unclosed = project(file("pending", "good.md", "# Good"), file("pending", "bad.md", "# Visible\n~~~markdown\n## Problem\nSecret example text\n"));
    expect(unclosed).toMatchObject({ availability: "available", countsComplete: true, limited: true, counts: { totalFiles: 2, unavailable: 1, displayed: 1 } });
    expect(JSON.stringify(unclosed)).not.toContain("Secret example text");
  });

  it("projects observed major and cosmetic levels separately and falls back from overlong metadata titles", () => {
    const result = project(file("pending", "importance.md", `---\ntitle: ${"Too long ".repeat(40)}\nseverity: major\npriority: cosmetic\n---\n# A safe heading\n`));
    expect(result.items[0]).toMatchObject({ title: "A safe heading", severity: "major", priority: "cosmetic" });
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
  });

  it("treats repeated frontmatter status as an unavailable item rather than silently dropping conflict evidence", () => {
    const result = project(file("pending", "ambiguous.md", "---\nstatus: done\nstatus: open\n---\n# Ambiguous\n"), file("pending", "valid.md", "# Valid\n"));
    expect(result).toMatchObject({ countsComplete: true, limited: true, counts: { pending: 2, totalFiles: 2, unavailable: 1, displayed: 1 } });
    expect(result.items[0].title).toBe("Valid");
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
  });

  it("preserves case-sensitive Linux filename identity while detecting exact cross-folder duplicates", () => {
    const result = project(file("pending", "Task.md", "# Uppercase"), file("backlog", "task.md", "# Lowercase"), file("done", "Task.md", "# Exact match"));
    expect(result.counts).toMatchObject({ totalFiles: 3, distinctTasks: 2, duplicates: 2 });
    expect(result.items.find((item) => item.title === "Lowercase")?.duplicateName).toBe(false);
    expect(result.items.filter((item) => item.duplicateName)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/Task\.md|task\.md/);
  });

  it("marks counts incomplete when reader cannot enumerate TODO files without inflating observed physical counts", () => {
    const result = buildTodos(inventory([file("pending", "visible.md", "# Visible")], { problems: [{ kind: "todo", warning: "limit-reached" }, { kind: "todo", warning: "oversize" }] }));
    expect(result).toMatchObject({ countsComplete: false, limited: true, counts: { totalFiles: 1, unavailable: 2, displayed: 1 } });
    expect(BoardTodosSchema.safeParse(result).success).toBe(true);
  });

  it("ignores unrelated inventory failures and rejects unexpected DTO fields", () => {
    const result = buildTodos(inventory([], { problems: [{ kind: "uat", warning: "limit-reached" }], limited: true }));
    expect(result.limited).toBe(false);
    expect(BoardTodosSchema.safeParse({ ...result, key: "todos/private.md" }).success).toBe(false);
    expect(BoardTodosSchema.safeParse({ ...result, items: [{ ...project(file("", "safe.md", "# Safe item")).items[0], key: "todos/safe.md" }] }).success).toBe(false);
  });
});

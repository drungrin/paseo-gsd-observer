import { describe, expect, it } from "vitest";
import { summaryIntro } from "../../server/summary-intro";
import { PathFreeTextSchema } from "../../shared/validation";
import type { AllowedArtifact } from "../../server/allowed-reader";

const artifact = (text: string): AllowedArtifact => {
  const bytes = new TextEncoder().encode(text);
  return { key: "phases/59.3-contracts/59.3-03-SUMMARY.md", kind: "summary", phaseId: "59.3", bytes, size: bytes.byteLength };
};
const document = (body: string) => artifact(`---\nphase: 59.3-contracts\nplan: '03'\nstatus: halted\n---\n${body}`);

describe("summary introduction", () => {
  it("reads the first bold prose paragraph after the real H1, preserving its language but not later sections", () => {
    const result = summaryIntro(document(`# Phase 59.3 Plan 03: Lifecycle contratual persistente — Summary

**Processos e instrumentos agora carregam lifecycle explícito, rascunhos sem dados fictícios e encerramento auditável, preservando o histórico confirmado existente sem DML retroativo.**

## Accomplishments

This later section claims everything passed.
`));
    expect(result).toEqual({ text: "Processos e instrumentos agora carregam lifecycle explícito, rascunhos sem dados fictícios e encerramento auditável, preservando o histórico confirmado existente sem DML retroativo.", limited: false });
    expect(PathFreeTextSchema(640).safeParse(result.text).success).toBe(true);
  });

  it("accepts a plain intro and ignores frontmatter comments, fenced headings, tables, lists and later prose", () => {
    const result = summaryIntro(artifact(`---
# Fake H1 in YAML
phase: 59.3-contracts
plan: '03'
---
~~~sh
# Fake H1 in command output
<!-- should not start an HTML comment inside a fence
~~~
<!--
# Fake H1 in an HTML comment
-->
# Plano 03: Diagnóstico

| Status | Result |
| --- | --- |
- [x] A status marker is not prose.

The real introductory note was halted pending a person.
It remains unverified.

A second paragraph must not appear.
## Verification
The later claim must not appear.
`));
    expect(result).toEqual({ text: "The real introductory note was halted pending a person. It remains unverified.", limited: false });
  });

  it("does not borrow a later section, another paragraph, or a fenced passage for an absent introduction", () => {
    expect(summaryIntro(document("# Summary\n\n## Later\nA false intro.\n"))).toEqual({ text: null, limited: false });
    expect(summaryIntro(document("# Summary\n\n```text\nThis is not an introduction.\n```\n\n## Later\nA false intro.\n"))).toEqual({ text: null, limited: false });
    expect(summaryIntro(document("# Summary\n\n<!--\n## fake heading\n"))).toEqual({ text: null, limited: true });
    expect(summaryIntro(document("# Summary\n\n```text\nunclosed fence\n"))).toEqual({ text: null, limited: true });
    expect(summaryIntro(document("There is no H1.\n## Later\nA false intro.\n"))).toEqual({ text: null, limited: false });
  });

  it("masks paths, hosts, commands, credentials and identifiers rather than sending raw Markdown", () => {
    const result = summaryIntro(document(`# Plan 03: Example

**The build at /home/person/private/app and db.internal:5432 used npm run test, Bearer abcdefghijklmnopqrstu, 6194c33f-0c9b-4870-b2d8-8236ba7606fd and 8961c667c16ffc1976501cae06186b8e859bef2a; the result is pending.**

## Next
`));
    const serialized = JSON.stringify(result);
    for (const secret of ["/home", "db.internal", "npm run test", "abcdefghijklmnopqrstu", "6194c33f", "8961c667", "<b>"]) expect(serialized).not.toContain(secret);
    expect(result).toMatchObject({ limited: true });
    if (result.text) expect(PathFreeTextSchema(640).safeParse(result.text).success).toBe(true);
  });

  it("shortens only at a safe sentence boundary, never asserting a truncated outcome", () => {
    const result = summaryIntro(document(`# Plan 03: Example

The gate remains blocked. ${"A much longer later explanation remains only in this paragraph. ".repeat(20)}
`));
    expect(result).toEqual({ text: "The gate remains blocked.", limited: true });
    expect(summaryIntro(document(`# Plan 03: Example

${"Unfinished wording ".repeat(600)}
`))).toEqual({ text: null, limited: true });
  });

  it("rejects mismatched sizes, invalid UTF-8, malformed frontmatter and pathological lines locally", () => {
    const source = document("# Plan 03: Example\n\nSafe intro.\n");
    expect(summaryIntro({ ...source, size: source.size + 1 })).toEqual({ text: null, limited: true });
    expect(summaryIntro({ ...source, bytes: new Uint8Array([0xff]), size: 1 })).toEqual({ text: null, limited: true });
    expect(summaryIntro(artifact("---\nphase: 59.3-contracts\n# Not closed\n\n# Plan 03: Example\n\nPrivate intro.\n"))).toEqual({ text: null, limited: true });
    expect(summaryIntro(document(`# Plan 03: Example\n\n${"x".repeat(16_385)}\n`))).toEqual({ text: null, limited: true });
    expect(summaryIntro({ ...source, kind: "plan" })).toEqual({ text: null, limited: true });
  });
});

export type FixtureFile = { path: string; content: string };

export const fixtureFiles: readonly FixtureFile[] = [
  { path: ".planning/ROADMAP.md", content: "# Roadmap\n\n### Phase 2.2: Early\n\n### Phase 2.10: Later\n" },
  { path: ".planning/phases/02.2-early/02.2-CONTEXT.md", content: "# Context\n" },
  { path: ".planning/phases/02.2-early/02-01-PLAN.md", content: "---\nplan: '01'\n---\n# Plan\n" },
  { path: ".planning/phases/02.2-early/02-01-SUMMARY.md", content: "---\nstatus: complete\n---\n# Summary\n" },
  { path: ".planning/milestones/v0.1-ROADMAP.md", content: "# Archived roadmap\n" },
  { path: ".planning/milestones/v0.1-phases/01-old/01-CONTEXT.md", content: "# Archived phase\n" },
  { path: ".planning/phases/99-extra/99-CONTEXT.md", content: "# Outside roadmap\n" },
  { path: ".planning/reviews/02-REVIEW.md", content: "review: pending\n" },
  { path: ".planning/phases/02.2-early/02-UAT.md", content: "status: pending\n" },
  { path: ".planning/fixtures/malformed.md", content: "---\n[bad\n" },
  { path: ".planning/fixtures/truncated.md", content: "---\nphase: 2" },
  { path: ".planning/fixtures/unknown-version.json", content: '{"version":999}' },
  { path: ".planning/fixtures/oversize.md", content: "x".repeat(4097) },
];

export const fixtureFingerprint = (files = fixtureFiles) =>
  files.map(({ path, content }) => `${path}:${content.length}`).join("|");

export const evidenceCases = ["backlog", "discussed", "planned", "executing", "verifying", "completed"] as const;

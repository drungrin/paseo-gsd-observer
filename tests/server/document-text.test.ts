import { describe, expect, it } from "vitest";
import { atxHeading, markedHeading, readSections } from "../../server/document-text";

describe("Markdown headings", () => {
  it("reads ATX headings with optional indentation and closing hashes", () => {
    expect(atxHeading("## Phase 59.3: Contracts ##")).toEqual({ level: 2, text: "Phase 59.3: Contracts" });
    expect(atxHeading("   ### Phase 999.1: Parked (BACKLOG)")).toEqual({ level: 3, text: "Phase 999.1: Parked (BACKLOG)" });
    expect(atxHeading("#\tTabbed")).toEqual({ level: 1, text: "Tabbed" });
    expect(atxHeading("    ## Indented code")).toBeNull();
    expect(atxHeading(" ## One space", 0)).toBeNull();
    expect(atxHeading("####### Seven")).toBeNull();
    expect(atxHeading("##NoSpace")).toBeNull();
    expect(atxHeading("##   ")).toBeNull();
    expect(markedHeading("### 3. Login works  ", "###")).toBe("3. Login works");
    expect(markedHeading("#### Deeper", "###")).toBeNull();
    expect(markedHeading("# Plan 01: Title", "#")).toBe("Plan 01: Title");
    expect(readSections("intro\n## First\na\n### Nested\nb\n## Second ##\nc")?.map((section) => section.heading)).toEqual([null, "First", "Second"]);
  });

  it("stays linear on headings padded with long runs of whitespace", () => {
    const padding = " ".repeat(16_000);
    const started = performance.now();
    for (let index = 0; index < 20; index++) {
      atxHeading(`## a${padding}b`);
      atxHeading(`# a${padding}#`);
      markedHeading(`### a${padding}b`, "###");
    }
    readSections(Array.from({ length: 10 }, () => `## a${padding}b`).join("\n"));
    expect(performance.now() - started).toBeLessThan(500);
    expect(atxHeading(`## a${padding}b`)?.text).toBe(`a${padding}b`);
  });
});

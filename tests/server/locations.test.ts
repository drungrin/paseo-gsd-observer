import { describe, expect, it } from "vitest";
import { isDisplayablePath, isFileName, isTechnologyName, maskPaths, redactPaths } from "../../shared/locations";

describe("display location policy", () => {
  it("shows project paths, word alternatives, reference lists, ratios and application routes", () => {
    for (const token of [
      "shared/safe-text.ts", "src/Acme.Billing/Services/Grpc/InvoiceProfileAdminGrpcService.cs", ".planning/phases/58-billing/58-20-PLAN.md", "./scripts/build.sh",
      "tests/Billing.Tests/Lifecycle/", "server/overview.ts:514", "server/overview.ts:514:9", "`shared/safe-text.ts`", "(src/app/page.tsx),",
      "src/Acme.Billing/Data/Configurations/AcmeInvoiceSchedulingProfileVersionConfiguration.cs", "src/Acme.Migrations/Data/Migrations/20260909000000_AddAcmeInvoiceSchedulingProfileVersions.cs",
      "@.planning/ROADMAP.md", "@src/Acme.Billing/AGENTS.md", "@./.codex/workflows/execute-plan.md", "@acme/db", "packages/db/migrations/{allocated}_snapshot.json",
      "schema/policy/compatibility.", "REST/gRPC/GraphQL", "validator/VM/form:", "R$/kg", "C#/F#", "/",
      "D-01/D-04/D-21", "D-18..D-20/D-32/D-33.", "REQ-04/05", "7/8", "16/10/2026",
      "/v1/auth/session", "/InvoiceProfile/Edit", "/contacts/import", "/users/list", "/Home/Index",
    ]) expect(isDisplayablePath(token), token).toBe(true);
  });

  it("withholds absolute, home, drive, UNC and escaping paths, URLs, hosts, commands and opaque tokens", () => {
    for (const token of [
      "/home/ana/projects/acme/src/x.cs", "/Users/ana/notes.md", "/root/.ssh", "/tmp/task1-red.log", "/var/run/docker.sock", "/etc/passwd", "/usr/bin/time",
      "/workspaces/acme/api", "/workspace/app", "/mnt/c/Users/ana", "/c/Users/ana", "/opt/app", "/home",
      "~/.claude/skills/x.md", "~/", "$HOME/.cache", "${HOME}/x", "%APPDATA%/x", "C:/Users/ana", "C:\\Users\\ana", "\\\\server\\share", "//cdn.example.com/x",
      "../outside/x.md", "../", "a/../b", ".../home/ana", "@/workspaces/acme/.codex/x.md", "@~/x.md", "@../x.md",
      "https://example.com/docs", "file:///home/ana/x", "github.com/org/repo", ".dev.example.com/x", "localhost/x", "db.internal:5432/app", "T-192.168.10.4/24", "10.0.0.1/24",
      "/gsd-review-backlog", "/gsd:plan-phase", "src/<sessionId>/x", "R${HOME}/x", "src/$(id)/x", "a//b", "x/y=z", "key/user@example.com",
      `prefix/${"a".repeat(80)}`, "keys/aB3dE5fG7hJ9kL1mN2pQ4rS", "digests/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b", "plain",
    ]) expect(isDisplayablePath(token), token).toBe(false);
  });

  it("tells file names from host names by their extension", () => {
    for (const token of ["safe-text.ts", "ROADMAP.md", "60.1-REVIEWS.md", "Program.cs", "package.json", "test_auth.py", ".env", ".planning", ".github", ".eslintrc.json", "overview.ts:42", "`dark.css`"]) expect(isFileName(token), token).toBe(true);
    for (const token of ["db.internal", "api.example.com", "orders.prod.company", "console.log", "Microsoft.NET.Test.Sdk", "e.g", "10.0.0.1", "plain", "db.internal:5432", ".dev.example.ai", ".example.com"]) expect(isFileName(token), token).toBe(false);
  });

  it("reads uppercase .NET framework names as prose, not hosts", () => {
    for (const token of ["ASP.NET", "VB.NET", "ADO.NET", "(ASP.NET),"]) expect(isTechnologyName(token), token).toBe(true);
    for (const token of ["example.net", "Example.NET", "ASP.NETX", "db.ASP.NET", ".NET"]) expect(isTechnologyName(token), token).toBe(false);
    expect(maskPaths("Migrar para ASP.NET Core e .NET 9")).toBe("Migrar para PATH Core e PATH 9");
  });

  it("masks only displayable locations and redacts every other slash token, keeping surrounding punctuation", () => {
    expect(maskPaths("Edit (shared/safe-text.ts), ROADMAP.md and /home/ana/x per D-01/D-04.")).toBe("Edit (PATH), PATH and /home/ana/x per PATH.");
    expect(redactPaths("Edit (shared/safe-text.ts), /home/ana/x, \"~/notes\" and https://x.dev/a; route /v1/auth.")).toBe("Edit (shared/safe-text.ts), [omitted], \"[omitted]\" and [omitted]; route /v1/auth.");
    expect(redactPaths("No locations here.")).toBe("No locations here.");
  });
});

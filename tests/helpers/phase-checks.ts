import type { BoardOverview } from "../../shared/overview";

type Checks = BoardOverview["plans"]["phases"][number]["checks"];
const missing = (): Checks["discuss"] => ({ observation: "not_observed", reportedStatus: null, compliant: null });
const observed = (reportedStatus: Checks["discuss"]["reportedStatus"] = null, compliant: boolean | null = null): Checks["discuss"] => ({ observation: "observed", reportedStatus, compliant });

export function phaseChecks(current = false): Checks {
  return {
    discuss: current ? observed() : missing(), research: current ? observed() : missing(),
    plan: {
      spec: missing(), skeleton: missing(), security: missing(), patterns: current ? observed() : missing(),
      uiSpec: current ? observed("draft") : missing(), aiSpec: missing(), planCheck: missing(), uiCheck: missing(),
      nyquist: current ? observed("draft", false) : missing(), windows: missing(), deferred: missing(),
    },
    execute: { codeReview: missing(), uiReview: missing(), evalReview: missing(), uat: missing(), coverage: missing() },
    verify: missing(),
  };
}

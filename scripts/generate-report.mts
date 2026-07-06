import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("reports", { recursive: true });
writeFileSync(
  "reports/progress-report.md",
  [
    "# MVP Progress",
    "",
    "- Workspace: initialized",
    "- Typecheck: tsgo script writes reports/typecheck-report.json",
    "- Verify: runs typecheck/lint/check/test/build/audits",
    "- Resume rule: inspect reports/*.json and docs/TDD_GUIDE.md before continuing",
  ].join("\n"),
);

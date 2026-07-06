# TDD Guide

This repo is developed in small red-green-refactor steps.

1. Write a failing contract, unit, component, service, page SEO, or CLI test.
2. Implement the smallest useful behavior.
3. Refactor only after the test passes.
4. Run the local target command, then `pnpm verify` before release.
5. Record failures and recovery steps in `reports/verify-report.json`.

Coverage gates are 90% for lines, statements, branches, and functions. Integration routes in app, page, fragment, and CLI tests must cover every public endpoint or command path implemented for the MVP.

Do not use skipped tests. Do not mock away route resolution, fragment fallback, budget checks, or SEO HTML assertions.

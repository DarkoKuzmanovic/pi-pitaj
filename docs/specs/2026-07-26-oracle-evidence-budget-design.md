# Oracle Evidence Budget Increase

**Date:** 2026-07-26  
**Status:** Approved design

## Goal

Raise pi-pitaj Oracle mode's host-mediated evidence-request hard cap from 3 to 9 while keeping the consultation bounded and read-only.

## Budget contract

- Maximum evidence requests per Oracle consultation: **9**.
- Maximum characters per evidence result: **4,000** (unchanged).
- Maximum aggregate evidence characters per consultation: **18,000**.
- The first reached limit stops further evidence requests. Nine calls are therefore most useful for small searches, listings, refusals, or targeted reads; five full-size 4,000-character results cannot all fit.
- Invalid and refused requests continue to consume the request budget but not the character budget.
- A caller may override the request cap downward from 9 to any integer from 1 through 8; it may not raise the hard maximum.

## Implementation surface

Update the budget constants and clamping tests in `oracle-policy.ts` / `oracle-policy.test.ts`; the public `maxEvidenceRequests` schema, description, and loop tests in `index.ts` / `oracle.test.ts`; prompt/result metadata through the existing constant-driven code; and the README plus `[Unreleased]` changelog. Do not add a settings field or change model routing.

## Preserved boundaries

The approved repository root remains mandatory. Oracle remains limited to `read_file`, `search`, `list_files`, and `git_diff`; sensitive-path denial, traversal/symlink defenses, redaction, per-result truncation, no shell/network/write access, and manual host-action handling remain unchanged.

## Verification

Use TDD: first make focused assertions expect 9 requests, refusal on request 10, and an 18,000-character aggregate cap; observe RED; then update production constants/schema and run the focused tests followed by the full extension suite, strict TypeScript, Biome, and a Pi load/schema smoke check. Inspect the final diff and keep delivery local with no release or push.

## Rollback

Revert the budget commit, or restore `ORACLE_MAX_EVIDENCE_REQUESTS = 3`, `ORACLE_MAX_TOTAL_CHARS = 12_000`, schema maximum 3, and matching docs/tests. Reload Pi afterward.

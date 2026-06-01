# M1-T5 — Documentation, verification, and close-out prep

## Preflight

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Project state: PMTI
- Intent: task packet plus implementation per user instruction after M1-T4 close-out
- PMTI write allowed: yes
- Task ID: M1-T5
- Dependencies: M1-T2, M1-T3, and M1-T4 completed
- Workspace strategy: `current-branch`

## Goal

Finalize M1 curated snapshot consult mode by documenting `/pitaj snapshot`, adding concise `/pitaj help` guidance, running final verification, and recording close-out evidence.

## In scope

- Update `README.md` to document `/pitaj snapshot`.
- Explain what snapshot context includes: question, recent user request when available, active plan/risks only when explicitly provided, recent bounded tool results when available, provenance labels, and truncation/omission metadata.
- Explain what snapshot mode excludes: no sidecar tools, no full-branch/default full transcript capture, no unbounded session scraping, no direct `pitaj` tool-schema snapshot field.
- Update `index.ts` `usageText()` with a concise `/pitaj snapshot` usage line and example.
- Add or update tests only as needed to lock help/documentation-sensitive behavior.
- Run final verification and record reviewer verdict plus remaining risks in a PMTI session log.

## Out of scope

- Do not add `/pitaj advise`, `/pitaj escalate`, `/pitaj config`, budgets, persistent history, or full-branch mode.
- Do not change `PitajParams` or add `autoContext`, `snapshot`, or similar direct tool parameters.
- Do not change snapshot capture mechanics from M1-T2/M1-T3/M1-T4 except to fix documented correctness issues found during verification/review.
- Do not broaden session access to `getBranch()` or `getEntries()`.

## Acceptance criteria

- README documents `/pitaj snapshot`, including includes/excludes and why it is not full-branch review.
- `/pitaj help` includes a concise snapshot example.
- Documentation/schema sanity pass confirms snapshot mode is not described as tool-enabled or full-branch by default.
- `npm test` passes.
- Strip checks pass for changed TypeScript files.
- Biome check has no new errors/warnings; the known existing optional-chain info in `helpers.ts:182` may remain recorded.
- Read-only reviewer returns no Critical/Important findings or fix-back is completed.
- `.pi/pmti/milestones/M1.md` and a new session log record M1-T5 completion, verification, reviewer verdict, and follow-up risks.

## Suggested implementation sequence

1. Add a failing/guarding test for `usageText()` if needed by exporting or testing through source assertions, or keep help change small and verify with source checks if export churn is not worthwhile.
2. Update `index.ts` help text with `/pitaj snapshot` syntax and example.
3. Update README quick start, command docs, and troubleshooting/files sections as needed.
4. Run tests and sanity checks.
5. Request fresh read-only review.
6. Apply bounded fix-back if needed.
7. Update PMTI milestone/session log close-out.

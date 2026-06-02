# M3-B3 worker report — Warning integration and close-out

**Status:** Complete
**Run:** M3-B3 implementation with inline warning integration, documentation, and tests.

## Changed files

- `helpers.ts` — added `buildInlineWarnings()` pure helper
- `usage.ts` — added `snapshot()` method to `UsageRecorder` interface
- `index.ts` — wired warnings into direct tool, `/pitaj`, and `/pitaj snapshot` result paths; updated `/pitaj help` text
- `helpers.test.ts` — added 9 new tests for warning builder and integration
- `README.md` — added Usage summary, Advisory budget warnings, Sidecar model limitations, Result block format sections

## Acceptance checklist results

- [x] Under-threshold consult result has no usage warning
- [x] Third low-risk/GPT-style consult includes advisory low-risk/GPT-style warning
- [x] Fourth+ low-risk/GPT-style consult still includes advisory warning
- [x] Third high-risk/Opus-style consult includes advisory high-risk/Opus-style warning
- [x] Fifth snapshot consult includes advisory snapshot/context-heavy warning
- [x] `/pitaj usage` and `/pitaj usage reset` still work (verified via existing M3-B2 tests)
- [x] Existing explicit `pitaj`, `model: "auto"`, `/pitaj <alias> ...`, `/pitaj snapshot ...`, and `/pitaj config ...` behavior remains backward compatible
- [x] README and `/pitaj help` document result blocks, usage commands, reset behavior, warning semantics, and sidecar no-tools/no-file-access boundary
- [x] `npm test` passes
- [x] Strip import check passes
- [x] Guardrail audit finds no full-branch capture, sidecar tools, provider credential persistence, hard budget blocking, pricing/cost estimation, or persistent usage history

## Verification summary

```
npm test:
ℹ tests 108
ℹ suites 18
ℹ pass 108
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~420
```

Strip import check: `strip-ok`

Guardrail audit: PASS — no restricted features found in helpers.ts, usage.ts, index.ts. All flagged items are legitimate documentation strings stating that sidecar has no tools and no full-branch capture.

## Key implementation notes

- `buildInlineWarnings()` in `helpers.ts` is a pure function that takes `UsageBudgetState` and returns compact advisory warning strings. Returns an empty array when no thresholds are reached.
- `UsageRecorder.snapshot()` was added to `usage.ts` so the result paths can read current-session totals without exposing the full store.
- All three result paths (direct tool, `/pitaj`, `/pitaj snapshot`) record usage first, then build warnings from the updated snapshot, then pass warnings to `formatResultForDisplay(..., { warnings })`.
- Answer-first contract is preserved: answer is always the first line; metadata and warnings follow.
- Warning wording uses "Run `/pitaj usage` for details or `/pitaj usage reset` to clear counters" — consistent with `/pitaj usage` documentation.
- Error paths (direct tool failures) continue to throw; they do not return formatted result blocks.

## Open risks

None identified.

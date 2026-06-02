Per READ-ONLY/no-edit instruction, I did **not** write `reviewer-report.md`. Findings are below.

## Verdict: Approved with minor notes

## Critical
- None.

## Important
- None.

## Minor
- **Machine-consumption ambiguity for direct tool callers** — `index.ts:543` now returns the formatted answer+metadata block as required, but `PitajResultDetails` does not include the raw answer (`index.ts:58-74`, `index.ts:240-256`). Callers needing exact answer text must parse around the formatter delimiter from `helpers.ts:582-640`, which can be ambiguous if the model answer itself contains similar footer text. Optional mitigation: include a stable `rawAnswer`/`answer` field in returned `details` while keeping visible content formatted.
- **Snapshot context source is implied, not explicit** — Snapshot output includes `snapshot: ...` and `sidecar: ... (snapshot context only)` (`helpers.ts:600-612`, `helpers.ts:626-632`), which is understandable, but tests do not assert a distinct `context: snapshot` source line (`helpers.test.ts:954-983`). If the contract is meant literally as `context: none/manual/snapshot`, consider adding/asserting `context: snapshot`.

## Correct
- Formatter is pure/exported from `helpers.ts` and does not import `index.ts` (`helpers.ts:571-641`).
- Direct tool and both slash-command consult paths use the same formatter (`index.ts:543`, `index.ts:614`, `index.ts:660`).
- Answer is rendered first, with footer metadata after it (`helpers.ts:582-637`; tested at `helpers.test.ts:892-907`).
- Metadata covers model/alias, mode/brevity, auto-route reason, no/manual context, snapshot category counts/lists, and sidecar no-tools/no-file-access notice (`helpers.ts:585-632`).
- Inert warnings extension point exists with safe default (`helpers.ts:562-568`, `helpers.ts:619-624`; tests at `helpers.test.ts:985-1001`).
- No out-of-scope usage tracking, budgets, `/pitaj usage`, sidecar tools, settings writes, or scraping found in reviewed changes.
- Verification rerun: `npm test` passed; strip import check passed.
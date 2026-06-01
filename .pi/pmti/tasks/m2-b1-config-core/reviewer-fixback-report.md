## Critical
- None. Prior snapshot regression is fixed: `index.ts:331-334` falls back to `DEFAULT_MAX_CONTEXT_CHARS`; regression coverage exists at `helpers.test.ts:475-484`.

## Important
- None. Unsupported `/pitaj config ...` now routes to config summary, not consultation: `helpers.ts:241-245`, `index.ts:458-462`; covered at `helpers.test.ts:805-808`.
- None. `maxOutputChars` precedence is centralized and used by runtime: `helpers.ts:271-276`, `index.ts:191`; covered at `helpers.test.ts:715-720`.

## Minor
- None. Batch A constraints verified: no interactive config write path, no direct tool schema fields for `config`/`snapshot`/`autoContext`, and no `getBranch(` / `getEntries(` in product sources.
- Verification passed: `npm test`, strip import check, and Biome check.

Batch A is ready for PMTI close-out before Batch B.

Read-only instruction prevented writing `reviewer-fixback-report.md`.
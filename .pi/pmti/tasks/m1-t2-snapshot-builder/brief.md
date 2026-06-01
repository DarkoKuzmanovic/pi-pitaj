# M1-T2 — Implement pure snapshot builder and tests

## Preflight

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Project state: PMTI
- Intent: task packet for implementation
- PMTI write allowed: yes; user requested preparation and immediate execution
- Milestone: `.pi/pmti/milestones/M1.md`
- Depends on: `M1-T1` completed 2026-06-01
- Blocks: `M1-T3`, `M1-T4`, `M1-T5`
- Workspace strategy: `current-branch`

## Goal

Implement a pure deterministic snapshot builder in `snapshot.ts` and tests that prove the M1 snapshot contract before runtime Pi session collection or `/pitaj snapshot` command wiring is added.

## Source of truth

- `.pi/pmti/milestones/M1.md` task `M1-T2`
- `.pi/pmti/project/decisions.md` decisions `M1-a` and `M1-b`
- `.pi/pmti/tasks/m1-t1-snapshot-contract/brief.md`
- `snapshot.ts` contract from M1-T1
- `helpers.test.ts` current Node test runner pattern

## In scope

- Add a pure exported builder such as `buildSnapshotContext(input: SnapshotBuildInput): SnapshotBuildResult` in `snapshot.ts`.
- Accept only structured inputs; do not read files, shell out, use network, or inspect Pi runtime/session objects.
- Produce context text plus metadata for included, omitted, and truncated categories.
- Keep category order from `SNAPSHOT_CATEGORY_ORDER`.
- Include a header that says the sidecar has no tools and only sees this snapshot.
- Render concrete provenance labels based on the M1-T1 template.
- Enforce `maxContextChars` with an explicit `[snapshot truncated ...]` marker.
- Treat `active-plan`, `risks`, `tool-results`, and `recent-user-request` as omitted when unavailable.
- Add deterministic tests, preferably in `helpers.test.ts` unless a new test file is intentionally added and `package.json` test command is updated.

## Out of scope

- Do not add runtime snapshot collection from `ExtensionContext` or `ctx.sessionManager`; that is M1-T3.
- Do not add `pi.on("tool_execution_end", ...)` ring-buffer code; that is M1-T3.
- Do not wire `/pitaj snapshot <question>` to `consultModel()`; that is M1-T4.
- Do not change `PitajParams` or add `autoContext`/snapshot tool-schema fields.
- Do not add `/pitaj advise`, `/pitaj escalate`, full-branch capture, config UI, budgets, or persistent consultation history.

## Acceptance criteria

- `buildSnapshotContext()` or equivalent is exported from `snapshot.ts` and uses no Pi runtime imports.
- Tests cover included categories, unavailable/omitted categories, ordering, provenance labels, and truncation markers.
- Tests cover noisy/raw tool-output handling by proving oversized category content is bounded/truncated rather than forwarded unmarked.
- Snapshot output clearly states the sidecar has no tools and only sees the snapshot.
- Existing `classifySpecialCommand("snapshot")` and existing pitaj tests still pass.
- No use of `any`, non-null assertions, source file reads, shell commands, network calls, `ctx.sessionManager.getBranch()`, or unbounded `getEntries()` in builder code.
- `npm test` passes.

## Suggested TDD sequence

1. Add tests for included categories/order/provenance and verify RED.
2. Implement minimal builder for included categories and omission metadata.
3. Add truncation/noisy-output tests and verify RED.
4. Implement category/whole-snapshot truncation and explicit marker.
5. Run full verification and request reviewer.

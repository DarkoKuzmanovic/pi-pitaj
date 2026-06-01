# M1-T3 — Add runtime snapshot collection seam

## Preflight

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Project state: PMTI
- Intent: task packet for implementation
- PMTI write allowed: yes; user requested preparation and immediate execution
- Milestone: `.pi/pmti/milestones/M1.md`
- Depends on: `M1-T2` completed 2026-06-01
- Blocks: `M1-T4`, `M1-T5`
- Workspace strategy: `current-branch`

## Goal

Add the runtime seam that converts bounded Pi/runtime data into structured `SnapshotBuildInput` categories for the pure M1-T2 builder, without wiring `/pitaj snapshot <question>` to consultation yet.

## Source of truth

- `.pi/pmti/milestones/M1.md` task `M1-T3`
- `.pi/pmti/project/decisions.md` decisions `M1-a` and `M1-b`
- `.pi/pmti/tasks/m1-t2-snapshot-builder/brief.md`
- `snapshot.ts` builder contract
- `index.ts` extension entry point and command/tool flow
- Pi extension docs for event hooks and `ExtensionContext`/session access

## In scope

- Add a small runtime helper/seam that prepares structured snapshot category inputs for `buildSnapshotContext()`.
- Register a bounded `pi.on("tool_execution_end", ...)` ring buffer in the `pitaj()` entry function if Pi event API supports that event in the current host API.
- Capture `tool-results` only from that bounded ring buffer; if unavailable or empty, omit gracefully.
- Capture `recent-user-request` only from bounded user-message access, with an explicit entry/count/char limit, or omit gracefully if API shape is unavailable.
- Keep `active-plan` and `risks` caller/custom-entry only and omitted by default.
- Produce included/omitted category metadata through the existing builder path or structured inputs.
- Add deterministic tests using fakes/mocks for the seam and ring buffer.

## Out of scope

- Do not wire `/pitaj snapshot <question>` to call `consultModel()`; that is M1-T4.
- Do not change the public `PitajParams` schema or add `autoContext`/snapshot fields.
- Do not add `/pitaj advise`, `/pitaj escalate`, full-branch mode, config UI, budgets, or persistent consultation history.
- Do not call `ctx.sessionManager.getBranch()`.
- Do not use unbounded `ctx.sessionManager.getEntries()`.
- Do not read product files, shell out, use network, or give the sidecar tools.

## Acceptance criteria

- Runtime seam is exported/testable and independent enough to test with fake session/tool data.
- Tool result buffer has a fixed item count and per-item/per-buffer character bounding.
- `tool_execution_end` registration, if added, lives in `pitaj()` in `index.ts` and is guarded so missing/unsupported event APIs degrade safely.
- Recent user request capture uses bounded entry access only; if the required session API cannot be verified, leave that category omitted with explicit metadata/support note rather than scanning broadly.
- `active-plan` and `risks` are omitted unless explicitly passed in structured caller/custom inputs.
- No normal `pitaj` tool calls or existing `/pitaj` non-snapshot commands change behavior.
- Tests prove ring-buffer bounding, graceful omission, and no tool-schema change.
- `npm test` passes.

## Suggested TDD sequence

1. Add tests for a bounded tool-result ring buffer and verify RED.
2. Implement the smallest ring buffer helper.
3. Add tests for runtime input collection with empty/unavailable runtime data and verify RED.
4. Implement the runtime seam with graceful omission.
5. Add tests or static checks proving no `PitajParams`/`autoContext` schema change and no broad session APIs.

# M1-T1 — Define snapshot contract and data model

## Preflight

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Project state: PMTI (`.pi/pmti/` present)
- Intent: implement one approved PMTI task, `M1-T1`
- PMTI write allowed: yes; task packet approved by orchestrator/human before implementation
- Workspace strategy: `current-branch`; verify cwd/workspace before editing and do not assume `main` is safe

## Source of truth

- Milestone: `.pi/pmti/milestones/M1.md`, task `M1-T1`
- Oracle review: `context-build/oracle-m1-review.md`
- Durable decisions: `.pi/pmti/project/decisions.md` (`P0-b`, `P0-c`, `P0-d`, `M1-a`, `M1-b`)

## Goal

Define the M1 snapshot boundary and data model so later tasks can build, collect, and wire `/pitaj snapshot` without re-deciding capture policy. This task may make small source/test/doc changes needed to lock the contract, but must not implement the full snapshot builder or runtime collection seam.

## In scope

- Add/export snapshot contract types in a suitable source file (`snapshot.ts` preferred if it keeps builder work isolated; otherwise `helpers.ts` if minimal).
- Extend `SpecialCommand` in `helpers.ts` to include `"snapshot"`.
- Update `classifySpecialCommand()` so normalized input exactly equal to `"snapshot"` returns `"snapshot"`.
- Add focused tests proving `classifySpecialCommand("snapshot") === "snapshot"` and regular questions such as `"snapshot this"` still return `"none"`.
- Record the contract in code comments/types and, if useful, a short README placeholder note that M1 snapshot support is planned but not fully wired yet.

## Out of scope

- Do not implement `buildSnapshotContext()` or equivalent full builder logic; that belongs to M1-T2.
- Do not collect runtime session/tool data; that belongs to M1-T3.
- Do not wire `/pitaj snapshot <question>` to `consultModel()`; that belongs to M1-T4.
- Do not change `PitajParams` or add `autoContext`/snapshot fields to the `pitaj` tool schema; this is deferred to M4.
- Do not call or introduce `ctx.sessionManager.getBranch()`.

## Required contract shape

Implement or document an equivalent strongly typed contract. Adjust names only if there is a concrete local style reason.

```ts
export type SnapshotCategory =
  | "question"
  | "recent-user-request"
  | "tool-results"
  | "active-plan"
  | "risks";

export type SnapshotSourceKind =
  | "caller"
  | "bounded-session"
  | "tool-result-ring-buffer"
  | "custom-entry";

export type SnapshotCategoryStatus = "included" | "omitted" | "truncated";

export interface SnapshotCategoryInput {
  category: SnapshotCategory;
  title: string;
  content?: string;
  sourceKind: SnapshotSourceKind;
  sourceLabel: string;
}

export interface SnapshotCategoryMetadata {
  category: SnapshotCategory;
  status: SnapshotCategoryStatus;
  sourceKind?: SnapshotSourceKind;
  sourceLabel?: string;
  charCount: number;
  itemCount?: number;
  omissionReason?: string;
  truncated?: boolean;
}

export interface SnapshotBuildInput {
  question: string;
  categories: SnapshotCategoryInput[];
  maxContextChars: number;
}

export interface SnapshotBuildResult {
  context: string;
  metadata: SnapshotCategoryMetadata[];
  omittedCategories: SnapshotCategory[];
  truncated: boolean;
}
```

## Capture policy locked by M1-T1

| Category | Capture mechanism | Behavior if unavailable |
|---|---|---|
| `question` | Caller-provided command parameter | Required; empty question follows existing `/pitaj` empty-question behavior |
| `recent-user-request` | `ctx.sessionManager.getEntries()` filtered to last N user `SessionMessageEntry` entries, bounded to `maxContextChars` | Omit if no bounded recent user message exists |
| `tool-results` | In-extension ring buffer populated by pre-registered `pi.on("tool_execution_end", ...)` hooks | Omit if ring buffer is empty |
| `active-plan` | Caller-provided context or extension-appended `CustomEntry` only | Omit by default; do not infer from session branch or general session message content |
| `risks` | Caller-provided context or extension-appended `CustomEntry` only | Omit by default; do not infer from session branch or general session message content |

## Provenance and ordering contract

- Category order: `question`, `recent-user-request`, `active-plan`, `tool-results`, `risks`.
- Provenance label template: `[snapshot:<category> — <itemCount> items, <charCount> chars, source: <sourceLabel>]`.
- For a single item, use `1 item`; for omitted categories, metadata uses `status: "omitted"` and an `omissionReason` rather than emitting empty body text.
- Snapshot text must state that the sidecar has no tools and only sees the supplied snapshot.
- Truncation policy for M1-T2 to implement: trim category content first where practical, then enforce whole-snapshot `maxContextChars` with an explicit truncation marker.

## Acceptance criteria

- `npm test` passes.
- `SpecialCommand` and `classifySpecialCommand()` include the exact `snapshot` dispatch case.
- Existing `help`, `aliases`, `models`, `check`, and normal-question routing tests remain valid.
- Snapshot contract types cover the five categories, metadata statuses, source kinds, omission reasons, provenance labels, and truncation metadata needed by M1-T2.
- No `PitajParams` schema change and no `autoContext`-style tool parameter is added.
- No full-branch/session serialization is introduced.
- If a new durable tradeoff appears, record it as `M1-c` or later in `.pi/pmti/project/decisions.md`; otherwise do not add decisions.

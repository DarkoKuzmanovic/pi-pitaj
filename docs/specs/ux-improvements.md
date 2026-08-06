# pi-pitaj UX improvements specification

**Status:** Planned Crew M4 candidate; not authorized or started
**Source:** 2026-06-14 source review and two GPT critique consults. Earlier expansion work is reflected in `CHANGELOG.md` and Git history.

Most earlier ideas—snapshot mode, config UI, auto-routing, and usage tracking—are shipped. This specification captures the next optional UX round.

## Architecture facts

- `helpers.ts` owns pure, unit-testable logic; `index.ts` is the Pi runtime and command shell.
- `classifySpecialCommand()` runs before alias resolution, so every new subcommand can shadow an alias.
- `resolveAutoRoute()` already applies routing only when `model === "auto"`; explicit model selection wins.
- `buildSnapshotCommandRequest()` already returns assembled context and included/truncated/omitted metadata, making a bounded preview feasible.
- Session-local conveniences must remain in-memory and must not imply that a stateless sidecar remembers prior turns.

## Shared command groundwork

- Add one `RESERVED_SUBCOMMANDS` source of truth covering existing and proposed commands.
- Add `isReservedAliasName()` and a load-time warning for settings aliases that collide with commands.
- Reuse that validation in any guided alias editor.
- Add a session-local successful-consult store in the `pitaj()` closure only if a selected outcome needs `last`, replay, or follow-up behavior.
- Never persist prompts, answers, or consult history as part of this groundwork.

## Cheap consultation conveniences

### `/pitaj examples`

Render a curated, copyable subset of `usageText()` examples without making a model call.

### `/pitaj last`

Re-render the last successful consult through `formatResultForDisplay()`. Return a clear “no previous consult in this session” message when empty.

### Quieter metadata

Consider `compact` and `full` metadata verbosity. Compact output must retain trust signals—model, route/reason, context source, truncation, and warnings—even if repetitive sidecar wording is shortened.

## Modes as subcommands

- Consider `/pitaj critique`, `/pitaj debug`, `/pitaj plan`, `/pitaj risk`, and `/pitaj answer` as thin syntax over the existing plain-consult path.
- Keep a single dispatch implementation; do not fork consultation behavior by mode.
- Decide precedence before coding. Recommended: an explicit `--mode` wins and the result metadata states that it overrode the subcommand.
- Reserve every selected command name before exposing it.

## Mode-aware auto-routing

Extend only the pure `resolveAutoRoute()` table:

- `plan` and `risk-check` may prefer the configured high route.
- `answer` and `critique` may prefer the configured low route.
- Do not silently hard-code `debug` to the low route; subtle debugging can justify the stronger model.
- Explicit models continue to bypass auto-routing.

This is the lowest-risk candidate because it is a pure function with focused coverage in `auto-routing.test.ts`.

## Stateful follow-ups and guided aliases

### `/pitaj again [model]`

Replay the previous successful request with an optional model override. Label the result as a replay.

### `/pitaj followup <text>`

Send a new request whose bounded context contains the prior question and answer. State plainly that prior content was resent; the sidecar did not remember it.

### `/pitaj alias add|list|remove|show`

- Implement alias mutations as pure helpers.
- Reject reserved names.
- Validate `provider/model` targets.
- Reuse the existing safe settings-write confirmation path.
- Do not silently overwrite bundled defaults.

**Open decision:** `serializeSettings()` currently writes the merged alias set. Removing a bundled default therefore needs either a prohibition or an explicit tombstone representation. Decide this before implementation.

## Snapshot preview and route dry-run

- Add a summarized snapshot preview showing sources, included/truncated/omitted categories, context size, and a clearly labeled estimate.
- Show full assembled context only through an explicit option; do not dump it by default.
- Label it “assembled context” and clarify that system-prompt scaffolding is excluded.
- A route dry-run may resolve `auto` routing and the final model without consulting.
- Both preview paths must return before `consultModel()` and record no consultation usage.

## Deliberately dropped

- Multi-model comparison panel: excessive cost, latency, and complexity.
- Bare `/pitaj more`: misleading for a stateless sidecar; an explicit follow-up is clearer.
- Universal TL;DR header: can distort critique, debug, and risk-check answers.

## Dependencies and sequencing

```text
Shared command groundwork
├── Cheap consultation conveniences
├── Modes as subcommands ── Mode-aware auto-routing
├── Stateful follow-ups and guided aliases
└── Snapshot preview and route dry-run
```

The groundwork and selected cheap conveniences form the smallest coherent first outcome. Modes and routing should ship together only after precedence is decided. Stateful aliases/follow-ups and preview can remain independent later outcomes.

**Risk, low to high:** pure routing table → examples/last → preview → mode precedence/collisions → stateful follow-ups and alias persistence.

## Open questions before Crew planning

1. Should bundled aliases be removable, and if so how is removal persisted?
2. Does an explicit `--mode` override a mode subcommand, or should the combination be rejected?
3. Which trust metadata may compact mode omit without making capability or truncation ambiguous?
4. Does current snapshot output contain enough information for a useful preview without adding a new capture source?
5. Which subset is valuable enough to promote after correctness-hardening work?

## Provenance

The original review read `index.ts` and `helpers.ts` completely and used two GPT critique consults. Durable catches retained here are command/alias namespace collision, snapshot-preview disclosure risk, session-state honesty, `debug` routing ambiguity, and preserving trust signals in compact output.

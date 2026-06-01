# pi-pitaj — PMTI charter

**Initialized:** 2026-05-30
**Refreshed:** 2026-06-01
**PMTI version:** v1.0.0
**Source:** PMTI initialization plus 2026-06-01 refresh from `IMPLEMENTATION_PLAN.md` and selected `pi-todo` PMTI decisions.

## Vision

`pi-pitaj` should be the low-friction way for a running Pi agent to ask a second model for a bounded, focused consultation without spawning a subagent or starting another Pi session.

The extension should make the easy path safe: MiniMax and other cheaper/default workers should be able to call `pitaj` proactively when a side opinion is useful, while the extension owns deterministic defaults for model selection, prompt shape, context limits, and overuse visibility.

## Primary user

The primary users are Pi coding agents, especially cheaper/default workers such as MiniMax, and the human operator who wants cheap/fast execution with selective GPT/Opus consultation.

## Risk profile

**Primary risk:** architecture and behavior-routing risk.

`pi-pitaj` is small, but it sits in the agent/tool prompting path. Bad defaults can waste expensive model calls, send too much context, create misleading sidecar answers, or make workers over-consult instead of reading/verifying locally.

**Review intensity:** PMTI milestone discipline with pre-code oracle review recommended before changes to routing policy, automatic context capture, full-branch capture, per-task budgets, or tool schemas exposed to agents.

## Default workspace strategy

**current-branch** — use the already selected project workspace/branch unless a milestone explicitly records a different strategy.

Do not assume `main` is safe. Milestone and task packets should still record the expected cwd plus branch/worktree state before implementation.

## Scope

### In

- Preserve the existing focused `pitaj` tool and `/pitaj` command as the primary consultation primitive.
- Keep model selection easy through extension-owned routing such as `model: "auto"`, explicit aliases, and concise risk guidance.
- Add a curated snapshot consult mode that sends a compact, bounded session summary instead of raw full-branch serialization.
- Include current decision point, recent user request, relevant tool results, open risks, and active plan when a snapshot mode is explicitly used.
- Add `/pitaj config` or equivalent UI only after the snapshot path works.
- Add advisor-style shortcuts only if they use the curated snapshot builder and clearly remain advisory.
- Keep optional full-branch capture behind explicit opt-in with cost/sensitivity warnings.
- Preserve existing aliases, `/pitaj` command behavior, and current direct `model` calls.
- Keep tests fast with the existing `node --experimental-strip-types --test helpers.test.ts` path unless a milestone intentionally changes the test setup.

### Out

- Giving sidecar models arbitrary Pi tools during a pitaj consult.
- Replacing `pi-subagents`; pitaj remains an inline consultation tool, not delegation.
- Blindly serializing and sending the whole conversation branch by default.
- Broad session-memory scraping or unbounded transcript/context dumping.
- Provider-specific hacks that make the public tool schema depend on one model vendor.
- Implementing `/pitaj config`, advisor shortcuts, budgets, and full-branch mode before the curated snapshot path is proven.

## Constraints

- **Tech stack:** TypeScript ESM Pi extension.
- **Host API:** use `ExtensionAPI`, `ExtensionContext`, `ctx.modelRegistry`, and `@earendil-works/pi-ai` streaming APIs already present in the extension.
- **Safety:** no secrets in prompts/results; no unbounded context capture; no tool claims by sidecar models.
- **Compatibility:** existing tool calls with explicit aliases, `model: "auto"`, and `/pitaj` command syntax keep working.
- **Agent usability:** promptGuidelines must name `pitaj` explicitly and teach workers when to call it without creating mandatory consultation ceremony.

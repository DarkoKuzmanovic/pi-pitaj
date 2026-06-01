# M0-T4 — Update agent-facing guidance and docs

**Status:** ready for executor  
**Milestone:** M0 — MiniMax-friendly auto-routing contract  
**Depends on:** M0-T3 for final examples  
**Blocks:** M0-T5  
**Packet prepared:** 2026-05-30

## Goal

Update the public docs and Pi tool guidance so MiniMax can choose `pitaj` auto-routing correctly, while preserving existing command examples and avoiding new command/runtime behavior.

## Required context

Read, in order:
1. `AGENTS.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/milestones/M0.md` M0-T4 section
4. `.pi/pmti/project/decisions.md` (`M0-b`)
5. `context-build/oracle-m0-review.md` M0-T4 packet notes
6. `.pi/pmti/tasks/m0-t3-tool-wiring/brief.md`
7. `index.ts`, `README.md`

## Implementation scope

Allowed changes:
- `index.ts` `promptGuidelines` only
- `README.md`

Do not change `helpers.ts`, `helpers.test.ts`, `settings.json`, runtime routing logic, command parsing, or PMTI decisions.

Do not change root `AGENTS.md` in this task unless the orchestrator explicitly asks; no AGENTS change is needed for M0-T4.

## Required `index.ts` changes

Update `promptGuidelines` to include a concise MiniMax-executable rubric. Preserve the existing “quick second opinion” and “bounded context” ideas, but expand them with these points:

- Use `pitaj` with `model: 'auto', risk: 'low'` for bounded technical questions: debug, API uncertainty, syntax check, localized code review.
- Use `pitaj` with `model: 'auto', risk: 'high'` for architectural decisions, security, data-integrity concerns, or hard-to-reverse changes.
- Use explicit aliases (`model: 'opus'`, `model: 'gpt'`) when you already know which model you need.
- Do not use `pitaj` for simple facts you can verify locally with `read`, `grep`, or `bash`.
- `pitaj` is a sidecar consultation, not a subagent. It has no tools and cannot inspect files unless you provide context.

Keep each guideline short enough for the tool description shown to MiniMax.

## Required README changes

1. Preserve all existing examples.
2. Update the tool usage JSON example or add a second one for auto-routing:

```json
{
  "model": "auto",
  "risk": "low",
  "mode": "debug",
  "question": "Is this TypeScript narrowing approach sound?",
  "context": "Relevant code excerpt here"
}
```

3. Update `Parameters` to include:
- `model`: optional alias/provider/model or `auto`.
- `risk`: optional `low` or `high`, only used when `model` is `auto`.
- Note that `pitaj` is a sidecar consult without tools; it cannot inspect files unless context is provided.

4. Include explicit examples for all three model styles:
- auto-routed call with `model: "auto"` and `risk` hint
- explicit `gpt`
- explicit `opus`

5. Keep `/pitaj auto` command syntax out of docs except to say auto-routing is available through the tool schema first in M0.

## Acceptance criteria

- `promptGuidelines` teach when to use auto low, auto high, explicit aliases, and when not to consult.
- README parameters describe `model: "auto"` and `risk` while preserving old alias/provider behavior.
- README includes examples for `model: "auto"`, explicit `gpt`, and explicit `opus`.
- README states `pitaj` is a sidecar consult without tools and needs caller-supplied context.
- No runtime behavior changes are introduced.
- `npm test` passes from `/home/quzma/.pi/agent/extensions/pi-pitaj`.

## Guardrails

- Do not add `auto` as a settings alias.
- Do not add `/pitaj auto` command parsing.
- Do not register convenience tools.
- Do not add context capture or budget tracking.
- Keep docs concise; this is usage guidance, not a long architecture essay.

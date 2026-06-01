# Handoff — M0-T4 docs and guidance

Use this prompt for the executor.

```text
You are implementing PMTI task M0-T4 for pi-pitaj at /home/quzma/.pi/agent/extensions/pi-pitaj.

Read first:
- AGENTS.md
- .pi/pmti/project/roadmap.md
- .pi/pmti/milestones/M0.md
- .pi/pmti/project/decisions.md
- context-build/oracle-m0-review.md, especially the M0-T4 packet notes
- .pi/pmti/tasks/m0-t3-tool-wiring/brief.md
- .pi/pmti/tasks/m0-t4-docs-guidance/brief.md
- index.ts
- README.md

Task: update agent-facing guidance and README docs for the M0 auto-routing contract.

Allowed changes:
- index.ts promptGuidelines only
- README.md

Do not change helpers.ts, helpers.test.ts, settings.json, runtime routing, command parsing, PMTI files, or AGENTS.md. Do not add /pitaj auto command behavior or any new tools.

Required index.ts change:
- Expand `promptGuidelines` to include concise guidance for:
  - `model: 'auto', risk: 'low'` for bounded technical questions: debug, API uncertainty, syntax check, localized code review.
  - `model: 'auto', risk: 'high'` for architecture, security, data integrity, or hard-to-reverse changes.
  - explicit `model: 'opus'` or `model: 'gpt'` when the caller already knows the model.
  - no pitaj for simple facts verifiable locally with read/grep/bash.
  - pitaj is a tool-less sidecar, not a subagent; it cannot inspect files unless context is provided.

Required README changes:
- Preserve existing examples.
- Document `model: "auto"` and `risk?: "low" | "high"` in parameters.
- Include examples for `model: "auto"`, explicit `gpt`, and explicit `opus`.
- State sidecar/tool-less limitation and caller-supplied context requirement.
- Mention that `/pitaj auto` command syntax is not enabled in M0; auto-routing is through the tool schema first.

Verification:
- Run `npm test` from /home/quzma/.pi/agent/extensions/pi-pitaj.
- Report changed files and exact result.

Stop if you believe AGENTS.md must change or if docs cannot be updated without changing runtime behavior.
```

## Expected changed files

- `index.ts`
- `README.md`

## Stop conditions

Stop and report instead of broadening scope if:
- a root `AGENTS.md` change seems necessary;
- runtime code changes seem required;
- `/pitaj auto` command parsing seems necessary;
- tests fail for reasons outside the allowed files.

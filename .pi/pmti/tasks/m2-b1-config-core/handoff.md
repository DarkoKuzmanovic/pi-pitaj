# Handoff — M2-B1 config core

## Workspace

```text
Workspace strategy: current-branch
Expected branch/worktree: n/a; use cwd /home/quzma/.pi/agent/extensions/pi-pitaj
Workspace owner: orchestrator/executor on current working tree
Close-out owner: orchestrator/human via PMTI close-out; no git branch close-out is expected because this directory is not a git repo
```

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

## Executor prompt

Implement PMTI batch `M2-B1-config-core` from `.pi/pmti/tasks/m2-b1-config-core/`.

Read first:

- `.pi/pmti/tasks/m2-b1-config-core/brief.md`
- `.pi/pmti/tasks/m2-b1-config-core/handoff.md`
- `.pi/pmti/milestones/M2.md`
- `.pi/pmti/project/decisions.md`
- `.pi/pmti/project/watch.md`
- product files needed for the implementation: `helpers.ts`, `index.ts`, `helpers.test.ts`, `settings.json`, and README only if needed for existing docs/help examples.

Goal: implement only Batch A (M2-T1 through M2-T3): config contract/settings semantics, safe settings helpers/runtime output-limit semantics, and `/pitaj config` summary/non-UI fallback.

Do not implement Batch B behavior. Specifically do not add an interactive config editing UI, do not expose user-facing settings writes from `/pitaj config`, and do not close M2.

Hard constraints:

- Use the existing `worker` agent model configuration. In this environment the worker is configured as `minimax/MiniMax-M3`; do not override to GLM/DeepSeek.
- Preserve existing explicit `pitaj` tool calls, `/pitaj <alias|provider/model> ...`, `/pitaj snapshot ...`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, and `model: "auto"` behavior.
- Store auto-route targets as alias names (`M2-a`), defaults `gpt` and `opus`.
- Treat absent numeric settings fields as undefined for intentional precedence fallthrough (`M2-b`).
- Respect fast-lane scope (`M2-c`): Batch A must be verified/reviewed before Batch B starts.
- No direct `pitaj` tool schema fields for config/snapshot/autoContext.
- No full-branch capture, `getBranch(`, or `getEntries(` additions.
- No provider credential/API key persistence or edits outside this extension's `settings.json`.
- TypeScript style: no `any`, no non-null assertions, use `import type` for type-only imports.

Implementation expectations:

1. Use TDD for behavior changes. Add failing tests first for the key contract and command-routing behavior where practical.
2. Implement pure settings helpers in `helpers.ts` or a focused module if that keeps `index.ts` small.
3. Update runtime consult output-limit precedence to request override > explicit settings value > brevity default.
4. Add `/pitaj config` summary/non-UI fallback and exact `config` command classification.
5. Keep source changes surgical.

Verification to run:

```bash
npm test
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
bunx --bun @biomejs/biome check helpers.ts index.ts helpers.test.ts
```

If you add a new TypeScript module, include it in strip and Biome checks.

Recovery discipline:

```text
If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.
After a syntax error, inspect the whole edited file before running more tests.
```

Stop and report ambiguity instead of guessing if:

- settings file-state behavior requires a decision not already in `M2-a`/`M2-b`/`M2-c`;
- implementing `/pitaj config` summary seems to require interactive UI;
- preserving existing snapshot/direct-tool behavior conflicts with the config command routing;
- verification failures point to wider architecture than Batch A.

## Expected worker report

Return a concise report with:

- files changed;
- tests added/updated;
- behavior implemented;
- exact verification commands and results;
- any skipped/deferred items for Batch B;
- whether Batch A is ready for fresh-context review.

Do not mark PMTI milestone/task state complete and do not edit `.pi/pmti/milestones/M2.md` status after implementation. The orchestrator will verify, review, and record durable PMTI updates.

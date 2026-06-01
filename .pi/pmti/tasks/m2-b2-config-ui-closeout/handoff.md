# Handoff — M2-B2 config UI close-out

## Workspace

```text
Workspace strategy: current-branch
Expected branch/worktree: n/a; use cwd /home/quzma/.pi/agent/extensions/pi-pitaj
Workspace owner: orchestrator/executor on current working tree
Close-out owner: orchestrator/human via PMTI close-out; no git branch close-out is expected because this directory is not a git repo
```

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

## Executor prompt

Implement PMTI batch `M2-B2-config-ui-closeout` from `.pi/pmti/tasks/m2-b2-config-ui-closeout/`.

Read first:

- `.pi/pmti/tasks/m2-b2-config-ui-closeout/brief.md`
- `.pi/pmti/tasks/m2-b2-config-ui-closeout/handoff.md`
- `.pi/pmti/milestones/M2.md`
- `.pi/pmti/project/decisions.md`
- `.pi/pmti/project/watch.md`
- `.pi/pmti/project/session-log/2026-06-01-015.md`
- product files needed for implementation: `helpers.ts`, `index.ts`, `helpers.test.ts`, `README.md`, and `settings.json` only if needed.

Goal: implement only Batch B (M2-T4 through M2-T5): interactive config update flow, safe confirmed settings writes, docs/help updates, verification, review, and close-out evidence.

Hard constraints:

- Batch A is complete and reviewed; do not reopen its settings contract unless a blocker makes the Batch B writer unsafe.
- Preserve existing explicit `pitaj` tool calls, `/pitaj <alias|provider/model> ...`, `/pitaj snapshot ...`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, `/pitaj config show`, and `model: "auto"` behavior.
- Store auto-route targets as alias names (`M2-a`), defaults `gpt` and `opus`.
- Treat absent numeric settings fields as undefined for precedence fallthrough (`M2-b`).
- Respect fast-lane scope (`M2-c`): final verification and reviewer are required before M2 close-out.
- No direct `pitaj` tool schema fields for config/snapshot/autoContext.
- No full-branch capture, `getBranch(`, or `getEntries(` additions.
- No provider credential/API key persistence or edits outside this extension's `settings.json`.
- TypeScript style: no `any`, no non-null assertions, use `import type` for type-only imports.

Implementation expectations:

1. Verify Pi UI signatures from installed docs/types before implementation.
2. Use TDD for helper behavior and command-routing regressions where practical.
3. Implement a UI path for `/pitaj config` only when `ctx.hasUI` is true; `/pitaj config show` remains summary-only.
4. Before writing settings, validate changes, show changed-fields summary, and require confirmation.
5. Use Batch A write-safety planning: create when not-found, overwrite only when loaded, refuse malformed with manual recovery instructions.
6. Defer alias editing unless it can be safely implemented without broadening scope; document manual alias editing clearly.
7. Keep source changes surgical.

Verification to run:

```bash
npm test
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
bunx --bun @biomejs/biome check helpers.ts index.ts helpers.test.ts
```

If you add a new TypeScript module, include it in strip and Biome checks. If README changes, sanity-check that README and `/pitaj help` describe the implemented behavior.

Recovery discipline:

```text
If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.
After a syntax error, inspect the whole edited file before running more tests.
```

Stop and report ambiguity instead of guessing if:

- Pi UI APIs cannot support a guided flow and the fallback would materially change write safety;
- settings serialization would drop valid manual aliases;
- malformed settings overwrite seems necessary;
- validation requires changing Pi global provider/model config;
- preserving existing snapshot/direct-tool behavior conflicts with the config command routing;
- verification failures point to wider architecture than Batch B.

## Expected worker report

Return a concise report with:

- files changed;
- tests added/updated;
- behavior implemented;
- exact verification commands and results;
- any skipped/deferred items (especially alias editing if deferred);
- whether Batch B is ready for fresh-context review and final M2 close-out.

Do not mark PMTI milestone state complete until after verification and reviewer pass. Durable PMTI updates after review belong to the orchestrator.

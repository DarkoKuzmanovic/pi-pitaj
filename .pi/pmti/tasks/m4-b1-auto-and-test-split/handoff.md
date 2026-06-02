# M4-B1 handoff — executor prompt

## Workspace

```
Workspace strategy: current-branch
Expected branch/worktree: current workspace (confirm before editing)
Workspace owner: executor
Close-out owner: orchestrator/human via finishing-development-branch
```

**Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.**

## Read list

Before starting, read:
- `.pi/pmti/tasks/m4-b1-auto-and-test-split/brief.md` (this task packet)
- `.pi/pmti/milestones/M4.md` (milestone plan with oracle findings)
- `.pi/pmti/project/decisions.md` (existing decisions)
- `helpers.ts` (full file — especially `classifySpecialCommand`, `parseCommandArgs`, `resolveAutoRoute`)
- `index.ts` (full file — especially `/pitaj` command dispatch chain, `consultModel`)
- `helpers.test.ts` (full file — all existing tests)
- `package.json` (test scripts)

## Executor prompt

```
Implement PMTI task M4-B1 from .pi/pmti/tasks/m4-b1-auto-and-test-split/brief.md.

STAY IN SCOPE. This batch has TWO tasks executed in order:
  1. M4-T1: /pitaj auto subcommand (Review lane)
  2. M4-T3: test file split (Fast lane)

=== TASK 1: /pitaj auto subcommand ===

A. helpers.ts — classifySpecialCommand extension:
   Locate the classifySpecialCommand function (~line 252). BEFORE the switch statement, add:
     if (normalized === "auto" || normalized.startsWith("auto ")) return "auto";
   This MUST go BEFORE the switch, using the same pattern as the existing "config" guard at line 254.
   DO NOT add a bare "case auto:" inside the switch — the switch only matches exact strings.
   Update the SpecialCommand type union to include "auto".

B. index.ts — dispatch branch:
   After the "usage" dispatch block (the block that starts with `if (specialCommand === "usage")`),
   and before the `parseSnapshotCommandArgs` line, add:
     if (specialCommand === "auto") {
       // Parse remaining args after "auto" to extract --risk, -m, -b, -c, and question
       const autoArgs = trimmed.substring("auto".length).trim();
       const parsed = parseCommandArgs(autoArgs, loaded.settings);
       
       // Validate --risk if present (must be "low" or "high")
       let risk = parsed.context; // parseCommandArgs stores unrecognized flags in context
       ... [figure out the cleanest way to extract risk from the parsed output]
       
       // Route through auto-router
       const request = { model: "auto", risk, question: parsed.question, mode: parsed.mode, brevity: parsed.brevity, context: parsed.context };
       // ... same consultModel pattern as the normal dispatch
     }

   IMPORTANT: The parsed.commandArgs stores --risk as part of the question text since it's not a recognized flag. You need to extract it. The simplest approach: scan the raw args string for "--risk low" or "--risk high" before passing to parseCommandArgs, OR add risk extraction logic. Invalid risk must throw a clear error.
   
   Route through resolveAutoRoute() + consultModel() — reuse the existing code path.
   Surface the same metadata as the tool API's model:"auto" path (autoRouted, routingReason, autoSuggestedMode).
   Use pi.sendMessage() with customType:"pitaj" (same pattern as the existing non-snapshot dispatch).
   Call recordUsageFromDetails() after successful consult.

C. usageText() — update:
   Add entry for /pitaj auto [--risk low|high] [existing flags] <question>.
   Add note: "auto and advise are reserved subcommand names and cannot be used as aliases."

D. Run tests — verify all existing tests pass plus any new auto tests you write.

=== TASK 2: test file split ===

E. Read helpers.test.ts in full. Identify test groupings:
   - auto-routing tests (resolveAutoRoute, auto-routing logic)
   - settings tests (settingsFromUnknown, mergeSettings, config update, serialization)
   - parsing tests (parseCommandArgs, tokenizer, model resolution)
   - Everything else stays in helpers.test.ts (snapshot, usage, formatting, display, special commands)

F. Create three new test files by copying ONLY the relevant describe/it blocks:
   - auto-routing.test.ts
   - settings.test.ts
   - parsing.test.ts

   Each file needs: the same imports as helpers.test.ts for its test subjects.
   Each file uses: `node --experimental-strip-types --test <file>` (same runner).

G. Remove the extracted tests from helpers.test.ts.

H. Verify: `node --experimental-strip-types --test helpers.test.ts auto-routing.test.ts settings.test.ts parsing.test.ts` all pass.
   Also run: `npm test` (which runs helpers.test.ts only — should still pass on remaining tests).

=== VERIFICATION ===
Run after all changes: `npm test` and all new test files pass.
Manual smoke: /pitaj auto --risk high is this safe?  (should route)
Manual smoke: /pitaj auto --risk bogus (should error with clear message)
```

## Edit discipline (every file you touch)

- One logical edit per file, then re-read that file before the next edit to it. Never stack multiple anchored edits on the same file without re-reading — stale line anchors cause duplicate or orphaned code.
- For any structured/code file where you must change more than one location, or add/remove a function or block, prefer rewriting the whole file with `write` over stacking `replace_lines`/`set_line` edits.
- After an edit, re-read the changed region and confirm structure is intact: no duplicate declaration/function bodies, balanced braces/parens, and every block you opened has its matching closer.
- Respect the project's module system and file conventions (TypeScript ESM, `import type`, no `require`).

## Failure handling

- After an edit warning or anchor mismatch, re-read before the next edit.
- After a syntax/parse error, inspect the whole edited file before running more tests.
- If the same file or same test fails twice, stop incremental patching: re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly. If that still fails, stop and report the file, the error, and the intended change instead of continuing with a corrupt file.

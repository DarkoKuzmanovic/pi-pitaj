# M4-B2 handoff — executor prompt

## Workspace

```
Workspace strategy: current-branch
Expected branch/worktree: current workspace (post M4-B1 — confirm before editing)
Workspace owner: executor
Close-out owner: orchestrator/human via finishing-development-branch
```

**Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.**

## Read list

Before starting, read:
- `.pi/pmti/tasks/m4-b2-advisor-and-closeout/brief.md` (this task packet)
- `.pi/pmti/milestones/M4.md` (milestone plan — especially oracle review section)
- `.pi/pmti/project/decisions.md` (existing decisions)
- `helpers.ts` (FULL file — post-T1 state; T1 added `auto` to `classifySpecialCommand` and `SpecialCommand`)
- `index.ts` (FULL file — post-T1 state; T1 added `auto` dispatch block)
- `helpers.test.ts` and any new test files created by M4-B1
- `README.md` (for T4 docs update)
- `AGENTS.md` (for PMTI block update)

**CRITICAL: M4-B1 modified `index.ts` and `helpers.ts`. The line numbers in the M4 milestone plan are now stale. Read both files in full before making any edits.**

## Executor prompt

```
Implement PMTI task M4-B2 from .pi/pmti/tasks/m4-b2-advisor-and-closeout/brief.md.

STAY IN SCOPE. This batch has TWO tasks executed in order:
  1. M4-T2: /pitaj advise zero-flag shortcut (Oracle lane)
  2. M4-T4: close-out docs and review

PREREQUISITE: M4-B1 must be complete and reviewed. Read index.ts and helpers.ts in full
before editing — M4-B1 modified these files and line anchors are stale.

=== TASK 1: /pitaj advise zero-flag shortcut ===

A. helpers.ts — classifySpecialCommand extension:
   Locate classifySpecialCommand. BEFORE the switch, add AFTER the "auto" guard:
     if (normalized === "advise" || normalized.startsWith("advise ")) return "advise";
   (Same pattern as auto and config — BEFORE switch, not inside it.)
   Update the SpecialCommand type to include "advise".

B. index.ts — dispatch branch:
   Add AFTER the "auto" dispatch, BEFORE parseSnapshotCommandArgs:
   
   if (specialCommand === "advise") {
     // Extract the part after "advise"
     const adviseInput = trimmed.substring("advise".length).trim();
     
     // ZERO-FLAG REJECTION — check for any flags or model arguments
     // Reject if adviseInput contains: --mode, -m, --brevity, -b, --context, -c
     // OR if the first token looks like a model (contains "/" or matches an alias)
     const adviseTokens = adviseInput.split(/\s+/);
     const firstToken = adviseTokens[0]?.toLowerCase();
     const forbiddenFlags = ["--mode", "-m", "--brevity", "-b", "--context", "-c"];
     const hasForbiddenFlags = forbiddenFlags.some(f => adviseTokens.includes(f));
     const looksLikeModel = firstToken && (firstToken.includes("/") || loaded.settings.aliases[firstToken]);
     
     if (hasForbiddenFlags || looksLikeModel) {
       ctx.ui.notify(
         "pitaj advise accepts only a bare question — no --mode, --brevity, -c, or model arguments. Use /pitaj snapshot for full options.",
         "warning"
       );
       return;
     }
     
     // Editor fallback for empty question
     let question = adviseInput;
     if (!question && ctx.hasUI) {
       const edited = await ctx.ui.editor("Question for pitaj advise", "");
       if (edited === undefined) { ctx.ui.notify("pitaj advise cancelled", "info"); return; }
       question = edited.trim();
     }
     if (!question) { ctx.ui.notify(usageText(), "info"); return; }
     
     // Build snapshot context via existing path
     const snapshotRequest = buildSnapshotCommandRequest(
       { question, model: undefined, mode: undefined, brevity: undefined, context: undefined },
       loaded.settings,
       { sessionManager: ctx.sessionManager, toolResults: snapshotToolResults },
     );
     
     // STOP-ON-VIOLATION: do not add fallback content if context is empty
     // The snapshot metadata handles omission provenance automatically
     
     ctx.ui.setStatus("pitaj advise", "asking...");
     try {
       const result = await consultModel(snapshotRequest.request, ctx, undefined, loaded);
       const details = { ...result.details, snapshot: snapshotRequest.snapshot };
       recordUsageFromDetails(snapshotRequest.request, details, { success: true, truncated: snapshotRequest.snapshot.truncated });
       const { totals } = usageRecorder.snapshot();
       const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
       
       // Advisory labeling: add advisory tag to the output
       const advisoryContent = formatResultForDisplay(result.answer, details, { warnings });
       
       pi.sendMessage({
         customType: "pitaj",
         content: advisoryContent,
         display: true,
         details,
       });
       ctx.ui.notify(`pitaj advise answered with ${result.details.model}`, "info");
     } catch (error) {
       const message = errorMessage(error);
       recordUsageFromDetails(snapshotRequest.request, { ...buildErrorDetails(snapshotRequest.request, loaded), snapshot: snapshotRequest.snapshot }, { success: false, truncated: snapshotRequest.snapshot.truncated });
       ctx.ui.notify(`pitaj advise failed: ${message}`, "error");
     } finally {
       ctx.ui.setStatus("pitaj advise", undefined);
     }
     return;
   }

C. usageText() — update:
   Add entry: "  /pitaj advise <question>"
   Add note: "  advise accepts only a bare question; use /pitaj snapshot for --mode/--brevity/-c/model options."

D. Formatting — the footer should distinguish advisory from regular snapshot.
   In formatResultForDisplay (helpers.ts), when snapshot is present: the context line already
   says "context: snapshot". For advisory, the snapshot details are set — the distinction
   is visible in usage recording (hasSnapshot: true) and the command path. No formatter
   changes needed IF the snapshot context line is sufficient. If you want explicit labeling,
   add an "advisory" tag in the footer metadata.

E. Write tests for the advise path. Test:
   - classifySpecialCommand returns "advise" for exact and prefix
   - Flag rejection cases
   - Model-first-token rejection
   - Normal question consult path

F. Run all tests.

=== TASK 2: close-out docs ===

G. Verify usageText() has both "auto" and "advise" entries (if M4-B1 didn't add "auto",
   add it now).

H. Update README.md:
   - Add /pitaj auto and /pitaj advise to the subcommand list
   - Note: auto and advise are reserved names, cannot be used as aliases

I. Update AGENTS.md PMTI managed block: record M4 completion date and note.

J. Create session log: .pi/pmti/project/session-log/2026-06-02-NNN.md with:
   - M4 oracle review date and verdict
   - M4-B1 implementation summary
   - M4-B2 implementation summary
   - Final test results
   - Open risks (if any)

K. Mark M4 status as "completed" in .pi/pmti/milestones/M4.md

=== VERIFICATION ===
Run: npm test and all test files pass.
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

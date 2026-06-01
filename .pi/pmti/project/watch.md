# PMTI watch list

Tech debt and deferred decisions with explicit re-check triggers.

## Sidecar tool boundary

**Trigger:** Re-check if a future milestone proposes giving pitaj sidecar models read, grep, bash, or other Pi tools.

**Question:** Is the requested capability still an inline consultation, or has it crossed into subagent delegation territory?

**Why carried forward:** The current design keeps sidecar models tool-less and honest about context. Tool access would require a different safety and audit model.

## Curated snapshot capture scope

**Trigger:** Re-check before M1 or any implementation that reads session history, recent tool output, active plans, diffs, or errors automatically.

**Question:** What exact context sources are captured, how are they bounded, and how does the sidecar know the provenance and limitations?

**Why carried forward:** Automatic context can make pitaj easier for MiniMax, but unbounded transcript stuffing would waste tokens and leak irrelevant or sensitive context. The accepted path is a curated snapshot, not full-branch capture by default.

## Full-branch opt-in boundary

**Trigger:** Re-check before implementing any `--full-branch` or equivalent advisor parity feature.

**Question:** What user action counts as explicit opt-in, what warning is shown, and how do existing `maxContextChars` safeguards apply?

**Why carried forward:** Whole-branch forwarding can be useful for escalation, but it is noisy and potentially sensitive. It must not become the default path.

## Consultation budget semantics

**Trigger:** Re-check before M3 budget or observability work.

**Question:** What is a “task” for budget reset purposes inside one Pi session, and should the extension warn, annotate, or block when the default budget is exceeded?

**Why carried forward:** The desired default budget is up to three GPT and three Opus calls per task, but Pi extension state must define reset and visibility semantics precisely.

## Settings/config write safety

**Trigger:** Re-check before `/pitaj config` or any UI that persists settings.

**Question:** Does the config UI preserve malformed-file fallback behavior, aliases, and manual edit compatibility?

**Why carried forward:** `settings.json` is part of the runtime model-routing path. Config convenience should not make settings less inspectable or harder to recover.

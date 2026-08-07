# pi-pitaj decisions

This file preserves durable product and architecture decisions. Completed implementation detail belongs in `CHANGELOG.md` and Git history; active execution state belongs only in a temporary root `PLAN.md` during an authorized Crew run.

## 2026-05-30 — Keep consultation explicit and bounded

**Status:** accepted

`pitaj` remains an explicit in-process sidecar consultation tool, not a replacement for `pi-subagents`. Ordinary consults receive only the caller-provided bounded context and have no tools or ambient file access.

This preserves auditability, predictable cost, and a clear capability boundary.

## 2026-05-30 — Use deterministic binary auto-routing

**Status:** accepted

`model: "auto"` uses `risk?: "low" | "high"`. Low risk routes through the configured low alias; high risk routes through the configured high alias. Omitted risk plus `mode: "risk-check"` uses the high route; other omitted-risk calls use the low route. Explicit model selections always win.

Route targets are alias names stored in settings rather than provider/model IDs, so operators can repoint them without changing routing code.

## 2026-06-01 — Curated snapshots omit unavailable plan and risk context

**Status:** accepted

Snapshot mode does not infer active plans or risks from broad session history. Those categories are caller-provided, supplied through an explicit extension custom entry, or omitted with provenance metadata.

Recent tool results are captured reactively through a bounded `tool_execution_end` ring buffer. The extension does not scan the conversation branch to reconstruct them.

## 2026-06-01 — Preserve safe and inspectable configuration

**Status:** accepted

Settings remain manually editable JSON. Interactive writes validate before persistence, preserve aliases, require confirmation, and refuse to silently overwrite malformed files.

`autoRouteLow` and `autoRouteHigh` store alias names. Absent numeric limits remain undefined so precedence can fall through as `request override > explicit setting > brevity default`.

## 2026-07-11 — Oracle exposes only bounded host-mediated evidence

**Status:** accepted; hardened in v0.3.0

Oracle mode exposes only `read_file`, `search`, `list_files`, and `git_diff`. Operations are read-only, root-relative, host-mediated, path-checked, secret-scanned, and bounded by request, per-result, and aggregate limits. The sidecar cannot run arbitrary commands, write files, select a new root/model, invoke Pi tools, or execute requested host actions automatically.

The stable-checkout assumption and sensitive-path policy are security invariants. The correctness and root-scope hardening defined in `docs/specs/correctness-hardening.md` shipped in v0.3.0; future changes to root scope, evidence disclosure, or secret handling remain protected-risk work.

## 2026-08-06 — Retire full active-conversation forwarding

**Status:** accepted

Do not add a mode that forwards the entire active Pi conversation branch. Curated snapshots cover bounded conversation context; Oracle covers bounded repository evidence. Full forwarding adds noise, cost, truncation ambiguity, and sensitivity exposure without enough distinct value.

Reconsider only for a concrete workflow that cannot be served by those two bounded paths.

## 2026-08-06 — Replace PMTI state with Crew conventions

**Status:** accepted

Crew is the sole planning workflow for future work. Root `ROADMAP.md` is strategic, root `PLAN.md` exists only while a build is active, root `DECISIONS.md` owns durable rationale, and `todo_write` mirrors only the current wave. Status is derived rather than duplicated across task packets, session logs, and state directories.

The legacy PMTI M0–M5 identifiers—including the never-built M5 full-branch milestone—are not reused as Crew milestones. Crew restarts numbering around shipped releases: M0 foundation, M1 targeted hardening, and M2 Oracle-lite. PMTI’s process decisions about current-branch execution, task packets, and execution lanes are superseded by Crew’s branch-first, tiered, risk-dominant workflow.

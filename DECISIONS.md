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
A structurally valid evidence round that names an unsupported tool is treated as a bounded refused request: no unknown host tool executes, the request consumes its slot, and the refusal is returned to the sidecar for recovery. Structurally missing tool calls and tool-use responses when evidence is disabled remain terminal protocol failures.

The stable-checkout assumption and sensitive-path policy are security invariants. The correctness and root-scope hardening defined in `docs/specs/correctness-hardening.md` shipped in v0.3.0; future changes to root scope, evidence disclosure, or secret handling remain protected-risk work.

## 2026-08-06 — Retire full active-conversation forwarding

**Status:** accepted

Do not add a mode that forwards the entire active Pi conversation branch. Curated snapshots cover bounded conversation context; Oracle covers bounded repository evidence. Full forwarding adds noise, cost, truncation ambiguity, and sensitivity exposure without enough distinct value.

Reconsider only for a concrete workflow that cannot be served by those two bounded paths.

## 2026-08-06 — Replace PMTI state with Crew conventions

**Status:** accepted

Crew is the sole planning workflow for future work. Root `ROADMAP.md` is strategic, root `PLAN.md` exists only while a build is active, root `DECISIONS.md` owns durable rationale, and `todo_write` mirrors only the current wave. Status is derived rather than duplicated across task packets, session logs, and state directories.

The legacy PMTI M0–M5 identifiers—including the never-built M5 full-branch milestone—are not reused as Crew milestones. Crew restarts numbering around shipped releases: M0 foundation, M1 targeted hardening, and M2 Oracle-lite. PMTI’s process decisions about current-branch execution, task packets, and execution lanes are superseded by Crew’s branch-first, tiered, risk-dominant workflow.

## 2026-08-07 — v0.3.1 runtime and persistence boundaries

**Status:** accepted; shipped in the 0.3.1 correctness patch

The sidecar must use the active Pi provider registry: resolve `ctx.modelRegistry.getProvider(model.provider)?.streamSimple`, and resolve auth with `getApiKeyAndHeaders(model)`. `ok: true` is sufficient for provider-scoped OAuth/cloud or other keyless auth; optional `apiKey` and `headers` are forwarded only when present. Iterator/result rejection and protocol-invalid tool use are terminal, and only accepted completed rounds contribute nested usage or Oracle messages.

Automatic snapshot sources are ambient but bounded: recent-user traversal and the reactive tool-result ring buffer are classified before retention, including complete multipart/tail text and top-level generic result strings before summary selection. Explicit question/context is caller-selected and remains unscanned. Secret classification is conservative mitigation, not proof of safety.

Settings remain at package-local `settings.json` with no migration in this release. Interactive writes patch only the selected known field, preserve unknown root fields and raw aliases, reject malformed/symlink/non-regular sources, compare source identity and exact content before and immediately before rename, fsync a fixed same-directory exclusive temp, atomically rename, and never retry conflicts. The narrow external race between the final check and rename remains documented residual trust.

The config UI validates every known field in the patched raw document before writing. Unknown fields remain preserved for forward compatibility, but invalid known fields require manual repair rather than being silently carried through an unrelated edit. Model references must resolve, normalized alias collisions are rejected, and `auto`/`advise` remain reserved aliases.

The local answer cap is characters (1..16,000); provider `maxTokens` is tokens (2,048/4,096/8,192 by brevity). They are separate accounting dimensions. Node.js 24 is the supported CI/runtime baseline.

P2.4, P2.6, O1, O2, and O3 are explicitly deferred. O4 has display-scope documentation only; no O4 code changes are part of 0.3.1.
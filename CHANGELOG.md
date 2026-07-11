# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.2.0] — planned

### Added

- **Oracle-lite mode** (`mode: "oracle"`) — bounded, read-only evidence consultation against an explicitly approved Git repository root (`oracleRoot`). No cwd fallback and no automatic root selection.
- Host-mediated evidence tool `pitaj_request_evidence` with exactly four operations: `read_file`, `search`, `list_files`, and `git_diff`. All paths are root-relative and read-only.
- Hard evidence budgets: 3 requests per consultation (override down to 1 via `maxEvidenceRequests`), 4,000 characters per result, 12,000 characters total. The 4th request is refused deterministically.
- Filesystem defense-in-depth: `realpath`/`lstat` ancestor checks, leaf `O_NOFOLLOW` opens, `fstat` regular-file verification, and a case-insensitive denylist for sensitive names and paths (`.git`, `.env*`, `.ssh`, `.aws`, `secret*`, `token*`, `password*`, `*.pem`, `*.key`, etc.).
- `git_diff` uses `--name-status -z` for robust path parsing and runs with `--no-ext-diff --no-textconv` to disable external helpers.
- `PITAJ_NEEDS_HOST_ACTION` protocol marker: when the sidecar needs an action outside its capability, it emits a structured marker (`PITAJ_NEEDS_HOST_ACTION`, `action: ...`, `reason: ...`) and stops; the host/main model must decide, perform the action outside Pitaj, and re-consult with bounded output if needed.
- Capability honesty: the Oracle system prompt and tool schema advertise the exact four operations and restrictions; result details advertise bounded read-only evidence, request/usage caps, and manual host actions. Ordinary modes continue to state that Pitaj has no tools and cannot inspect files unless context is provided.
- Installation guidance updated to recommend the pinned `pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.2.0` ref and to explain that unpinned `git:` installs follow the default branch (`main`).

### Changed

- `mode` schema now includes `"oracle"`. `oracleRoot` is required for Oracle mode; `maxEvidenceRequests` is optional and clamped 1..3.
- Prompt guidelines now qualify that ordinary modes are tool-less and that Oracle mode requires an explicit approved `oracleRoot`.

### Notes

- This release assumes a stable checkout: the approved `oracleRoot` must not be concurrently attacker-writable. The adapter rejects traversal and deterministic symlink escapes, but concurrent mid-path swaps are out of scope.
- Sensitive-path denial and content scanning are conservative mitigations, not complete secret detection.

## [0.1.1] — 2026-07-09

### Fixed

- `/pitaj auto` never computed inline usage-budget warnings, unlike the tool/advise/snapshot/plain-command paths, so the README's "result block includes a compact warning line" claim was false for that one path. Now mirrors the other four call sites (`usageRecorder.snapshot()` → `buildInlineWarnings(applyUsageWarningFlags(...))`).
- `helpers.test.ts`: a `mergeSettings({}, {...})` call passed 2 arguments to a 1-parameter function. The intended fixture (custom `defaultModel`, aliases) was silently discarded at runtime; the test only passed because `DEFAULT_SETTINGS` happens to also contain the same alias names.
- `settings.test.ts` (×4): `formatResultForDisplay`'s details argument was missing required fields (`mode`, `brevity`, `contextChars`) and carried a nonexistent `answer` property.

### Changed

- `roadmap.md` now lists M4 as completed instead of a candidate milestone.
- `README.md`'s Files/Testing sections now list all 5 test files (was still describing a single `helpers.test.ts`) and the previously-undocumented `usage.ts`.

All three issues were found by a full-extension Claude Fable production-truth review and independently verified against source, including a manual `tsc --noEmit --strict` run confirming the flagged type errors as real (this repo still has no typecheck gate in CI).

## [0.1.0] — 2026-05-30 to 2026-07-08

Initial build-out. All of the following landed under this version number, which was never bumped during active development.

### M0 — MiniMax-friendly auto-routing (2026-05-30)

- `model: "auto"` tool-schema support with deterministic `risk?: "low" | "high"` routing (`resolveAutoRoute()`): `risk: "low"` or omitted risk with a non-`risk-check` mode routes to the `gpt` alias; `risk: "high"` or omitted risk with `mode: "risk-check"` routes to `opus`.
- Explicit alias/`provider/model` calls always override auto-routing.
- Routing reason surfaced in result details; `promptGuidelines` teach MiniMax when to consult and which route to prefer.

### M1 — Curated snapshot consult mode (2026-06-01)

- `/pitaj snapshot <question>` — a pure, deterministic snapshot builder assembles bounded context (recent user request, tool-result ring buffer, caller-provided plan/risks) with provenance labels and truncation markers, then runs it through the existing consult path.
- Sidecar remains tool-less; snapshot explicitly excludes full-branch capture, secrets, and unbounded raw tool output.

### M2 — `/pitaj config` settings UI (2026-06-01)

- `/pitaj config` — effective-settings summary in any context, plus a guided interactive update flow (when `ctx.hasUI`) for default model, low/high auto-route aliases, default mode/brevity, and context/output limits.
- Safe write path: validates before writing, refuses to silently overwrite a malformed `settings.json`, requires confirmation, shows a changed-fields summary.
- Fixed `maxOutputChars` precedence (request override > settings value > brevity default); widened `autoRouteLow`/`autoRouteHigh` to configurable alias names (previously hardcoded `"gpt" | "opus"`).

### M3 — Consultation observability and budgets (2026-06-01)

- Answer-first result presentation: resolved route/model/mode, context source (none/manual/snapshot), and an explicit "sidecar has no tools/file access" notice, rendered compactly after the answer.
- In-memory, session-scoped usage accounting and `/pitaj usage` / `/pitaj usage reset`.
- Advisory, non-blocking budget warnings: 3+ low-risk/GPT-style or high-risk/Opus-style consults, 5+ snapshot consults in the current session.

### M4 — Convenience surface (2026-06-02)

- `/pitaj auto [--risk low|high]` slash command — command-surface parity with the tool API's `model: "auto"` routing.
- `/pitaj advise [question]` — zero-flag advisory shortcut wrapping the M1 curated snapshot builder; rejects `--mode`/`--brevity`/`-c`/model-as-first-arg to keep a real ergonomic distinction from `/pitaj snapshot`.
- `auto` and `advise` reserved as subcommand names (cannot be used as alias keys — intercepted before alias resolution).
- Test suite split from one ~1000-line `helpers.test.ts` into focused files.
- Oracle-reviewed plan (the advisory shortcut is an Oracle-lane affordance); fresh-context reviewer sign-off recorded before close-out.

### Post-M4 hardening (2026-06-11 – 2026-07-08)

- **Consult integrity** (2026-06-11): `consultModel` now honors stream `stopReason` — `error`/`aborted` throws instead of returning a dead stream as a normal answer; `length` returns an answer visibly marked provider-truncated. `autoRouteLow`/`autoRouteHigh` aliases are validated at settings load time (immediate warning instead of a confusing throw on the first `/pitaj auto` call). Parsing hardened: unbalanced quotes fall back to whitespace splitting instead of corrupting later tokens; the advise flag check now catches inline forms like `--mode=plan`. Truncated-answer counts surfaced in `/pitaj usage`. Source-grepping "wiring contract" tests replaced by executable behavior tests (new `consult-behavior.test.ts`). Test count went from 118 to 138.
- **Alias maintenance** (2026-07-04, 2026-07-05): dropped the dead `mimo` alias; fixed `spark` to point at `gpt-5.3-codex-spark`.
- **Install hygiene** (2026-07-08): added a default `.npmrc` (`omit=dev`) so a bare `npm install` skips dev-only tooling not needed at runtime.

Guardrail audits recorded at each milestone close-out (M0–M4) confirm no full-branch capture, no persistence, no token/cost accounting, and no sidecar tools were added.

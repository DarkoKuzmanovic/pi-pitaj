## Critical

- `buildSnapshotCommandRequest` now passes `settings.maxContextChars` directly into the snapshot builder, but M2 intentionally made absent numeric settings remain `undefined`. With a missing/absent `maxContextChars`, `/pitaj snapshot` produces a 1-character truncated snapshot instead of using the existing/default context limit. Evidence: `PitajSettings.maxContextChars` is optional (`helpers.ts:18`), `mergeSettings` only includes it when explicitly provided (`helpers.ts:153`), `buildSnapshotCommandRequest` forwards `settings.maxContextChars` without fallback (`index.ts:331-334`), and `buildSnapshotContext` normalizes non-finite values to `1` (`snapshot.ts:286-288`). I verified with a strip-types smoke snippet: `mergeSettings({ defaultModel: "opus" })` + `buildSnapshotCommandRequest(...)` returned `contextChars: 1` and `truncated: true`. This violates the Batch A hard requirement to preserve `/pitaj snapshot ...` behavior (`.pi/pmti/tasks/m2-b1-config-core/brief.md:68`) while supporting absent numeric settings (`brief.md:47`).

## Important

- Unsupported `/pitaj config ...` subcommands still fall through to a normal model consultation. `classifySpecialCommand` only returns `"config"` for exact `"config"` and `"config show"` (`helpers.ts:255-257`), then `default` returns `"none"` (`helpers.ts:258-259`), after which the command handler parses and consults normally (`index.ts:507-537`). The task explicitly says to add config routing "without treating `config ...` as a normal question" (`brief.md:64`) and Batch A must not expose editing/writes from `/pitaj config` (`brief.md:72-75`). A safe Batch A behavior would be summary/help/refusal for unsupported config subcommands, not sidecar consultation.

- Test coverage does not appear to cover the required runtime `maxOutputChars` precedence (`request.maxOutputChars > settings.maxOutputChars > brevity default`). The implementation line is correct-looking (`index.ts:191`), but the tests only check brevity constants (`helpers.test.ts:498-503`) and parsing/serialization of `maxOutputChars` (`helpers.test.ts:635-638`, `helpers.test.ts:750-762`); there is no behavioral test that exercises `consultModel` or truncation precedence. This misses the acceptance criterion in `brief.md:102`.

## Minor

- No prompt-risk sanity issue found in `/home/quzma/.pi/agent/model-prompts/minimax-m3.md`; the recovery-loop guidance is bounded to tool/edit/test failure handling and PMTI handoff discipline (`minimax-m3.md:5-11`, `minimax-m3.md:34-45`).

Batch A is **not ready for PMTI close-out before Batch B** because the `/pitaj snapshot` regression is a blocker against the stated preservation constraint.

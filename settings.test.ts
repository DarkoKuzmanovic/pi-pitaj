import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	BREVITY_OUTPUT_CHARS,
	CONFIG_EDITABLE_FIELDS,
	applyConfigUpdate,
	formatConfigSummaryText,
	formatResultForDisplay,
	formatSettingsChangeSummary,
	applyUsageWarningFlags,
	buildInlineWarnings,
	mergeSettings,
	planSettingsWrite,
	resolveAutoRoute,
	resolveMaxOutputChars,
	resolveModelRef,
	serializeSettings,
	settingsFromUnknown,
	summarizeSettings,
} from "./helpers.ts";
import { createUsageRecorder } from "./usage.ts";

const SETTINGS_PATH = "/home/quzma/.pi/agent/extensions/pi-pitaj/settings.json";

describe("pitaj settings and model aliases", () => {
	it("resolves shorthand aliases case-insensitively", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(resolveModelRef("Opus", settings), {
			input: "Opus",
			provider: "anthropic",
			modelId: "claude-opus-4-8",
			resolved: "anthropic/claude-opus-4-8",
			alias: "opus",
		});
	});

	it("accepts explicit provider/model references without an alias", () => {
		const settings = mergeSettings({ aliases: {} });
		assert.deepEqual(resolveModelRef("mimo/mimo-v2.5-pro", settings), {
			input: "mimo/mimo-v2.5-pro",
			provider: "mimo",
			modelId: "mimo-v2.5-pro",
			resolved: "mimo/mimo-v2.5-pro",
		});
	});

	it("falls back to defaultModel when no model is provided", () => {
		const settings = mergeSettings({
			defaultModel: "opus",
			aliases: { opus: "anthropic/claude-opus-4-8" },
		});
		assert.equal(resolveModelRef(undefined, settings).resolved, "anthropic/claude-opus-4-8");
	});

	it("throws a helpful error for unknown shorthand names", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.throws(() => resolveModelRef("unknown", settings), /Unknown pitaj model "unknown".*opus/s);
	});

	describe("M3-B3 result block warning integration", () => {
		it("records usage and formats result with no warning when under threshold", () => {
			const recorder = createUsageRecorder();
			recorder.recordFromRequest({
				requestedModel: "auto",
				resolvedModel: "openai/gpt-5.1",
				autoRouted: true,
				mode: "answer",
				brevity: "short",
				risk: "low",
				contextChars: 0,
				hasSnapshot: false,
				maxOutputChars: 4000,
				success: true,
			});
			const { totals } = recorder.snapshot();
			const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
			const text = formatResultForDisplay("Answer", { model: "openai/gpt-5.1", answer: "Answer" }, { warnings });
			assert.equal(warnings.length, 0);
			assert.match(text, /^Answer$/m);
		});

		it("records third low-risk consult and formats result with advisory warning", () => {
			const recorder = createUsageRecorder();
			for (let i = 0; i < 3; i += 1) {
				recorder.recordFromRequest({
					requestedModel: "auto",
					resolvedModel: "openai/gpt-5.1",
					autoRouted: true,
					mode: "answer",
					brevity: "short",
					risk: "low",
					contextChars: 0,
					hasSnapshot: false,
					maxOutputChars: 4000,
					success: true,
				});
			}
			const { totals } = recorder.snapshot();
			const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
			const text = formatResultForDisplay("Answer", { model: "openai/gpt-5.1", answer: "Answer" }, { warnings });
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /low-risk\/GPT-style consult/);
			assert.match(text, /^Answer$/m);
			assert.match(text, /---/);
			assert.match(text, /low-risk\/GPT-style consult/);
		});

		it("records fifth snapshot consult and formats result with snapshot warning", () => {
			const recorder = createUsageRecorder();
			for (let i = 0; i < 5; i += 1) {
				recorder.recordFromRequest({
					requestedModel: "auto",
					resolvedModel: "anthropic/claude-opus-4-8",
					autoRouted: true,
					mode: "answer",
					brevity: "short",
					risk: "high",
					contextChars: 5000,
					hasSnapshot: true,
					maxOutputChars: 4000,
					success: true,
				});
			}
			const { totals } = recorder.snapshot();
			const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
			const text = formatResultForDisplay("Answer", { model: "anthropic/claude-opus-4-8", answer: "Answer" }, { warnings });
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /snapshot consult/);
			assert.match(warnings[0], /bounded but still context-heavy/);
			assert.match(text, /^Answer$/m);
		});

		it("formats result with high-risk warning after third Opus-style consult", () => {
			const recorder = createUsageRecorder();
			for (let i = 0; i < 3; i += 1) {
				recorder.recordFromRequest({
					requestedModel: "opus",
					resolvedModel: "anthropic/claude-opus-4-8",
					resolvedAlias: "opus",
					autoRouted: false,
					mode: "risk-check",
					brevity: "short",
					contextChars: 0,
					hasSnapshot: false,
					maxOutputChars: 4000,
					success: true,
				});
			}
			const { totals } = recorder.snapshot();
			const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
			const text = formatResultForDisplay("Answer", { model: "anthropic/claude-opus-4-8", answer: "Answer" }, { warnings });
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /high-risk\/Opus-style consult/);
			assert.match(text, /^Answer$/m);
		});
	});
});

describe("pitaj M2 config contract", () => {
	it("leaves absent numeric fields as undefined in settingsFromUnknown", () => {
		const parsed = settingsFromUnknown({ defaultModel: "opus" });
		assert.equal(parsed.maxContextChars, undefined);
		assert.equal(parsed.maxOutputChars, undefined);
	});

	it("drops invalid numeric and string fields in settingsFromUnknown", () => {
		const parsed = settingsFromUnknown({
			defaultModel: 42,
			defaultMode: "wrong",
			defaultBrevity: "wrong",
			maxContextChars: "x",
			maxOutputChars: -1,
			aliases: { "": "target", OK: "  ", good: "anthropic/claude-opus-4-8" },
		});
		assert.equal(parsed.defaultModel, undefined);
		assert.equal(parsed.defaultMode, undefined);
		assert.equal(parsed.defaultBrevity, undefined);
		assert.equal(parsed.maxContextChars, undefined);
		assert.equal(parsed.maxOutputChars, undefined);
		assert.deepEqual(parsed.aliases, { good: "anthropic/claude-opus-4-8" });
	});

	it("parses new autoRouteLow and autoRouteHigh fields and ignores invalid values", () => {
		const parsed = settingsFromUnknown({ autoRouteLow: "gpt", autoRouteHigh: "opus47" });
		assert.equal(parsed.autoRouteLow, "gpt");
		assert.equal(parsed.autoRouteHigh, "opus47");
		const invalid = settingsFromUnknown({ autoRouteLow: 42, autoRouteHigh: "" });
		assert.equal(invalid.autoRouteLow, undefined);
		assert.equal(invalid.autoRouteHigh, undefined);
	});

	it("propagates undefined numerics through mergeSettings so brevity defaults still apply", () => {
		const settings = mergeSettings({ defaultModel: "opus" });
		assert.equal(settings.maxContextChars, undefined);
		assert.equal(settings.maxOutputChars, undefined);
		assert.equal(settings.autoRouteLow, undefined);
		assert.equal(settings.autoRouteHigh, undefined);
		assert.equal(settings.defaultModel, "opus");
		assert.equal(settings.aliases.gpt, "openai-codex/gpt-5.5");
	});

	it("does not require resolveAutoRoute alias to be a literal 'gpt' or 'opus'", () => {
		const settings = mergeSettings({
			autoRouteLow: "spark",
			autoRouteHigh: "opus47",
			aliases: { spark: "openai-codex/codex-5.3-spark", opus47: "anthropic/claude-opus-4-7" },
		});
		assert.equal(resolveAutoRoute({ risk: "low" }, settings).alias, "spark");
		assert.equal(resolveAutoRoute({ risk: "high" }, settings).alias, "opus47");
	});

	it("falls back to default 'gpt' and 'opus' auto-route aliases when settings don't override", () => {
		const settings = mergeSettings({
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		assert.equal(resolveAutoRoute({ risk: "low" }, settings).alias, "gpt");
		assert.equal(resolveAutoRoute({ risk: "high" }, settings).alias, "opus");
	});

	it("throws when configured autoRouteLow points to a missing or blank alias", () => {
		const settings = mergeSettings({ autoRouteLow: "missingAlias", aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "low" }, settings),
			/pitaj auto routing requires a non-empty "missingalias" alias/,
		);
	});

	it("resolves maxOutputChars with request then settings then brevity precedence", () => {
		const settings = mergeSettings({ maxOutputChars: 2222 });
		assert.equal(resolveMaxOutputChars(1111, settings, "short"), 1111);
		assert.equal(resolveMaxOutputChars(undefined, settings, "short"), 2222);
		assert.equal(resolveMaxOutputChars(undefined, mergeSettings(), "short"), BREVITY_OUTPUT_CHARS.short);
	});
});

describe("pitaj M2 config summary and validation helpers", () => {
	it("summarizes effective settings including auto-route aliases and file state", () => {
		const settings = mergeSettings({
			autoRouteLow: "gpt",
			autoRouteHigh: "opus",
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		const summary = summarizeSettings(settings, "loaded");
		assert.equal(summary.fileState, "loaded");
		assert.equal(summary.effective.defaultModel, "opus");
		assert.equal(summary.effective.defaultMode, "answer");
		assert.equal(summary.effective.defaultBrevity, "short");
		assert.equal(summary.effective.maxContextChars, undefined);
		assert.equal(summary.effective.maxOutputChars, undefined);
		assert.equal(summary.effective.autoRouteLow, "gpt");
		assert.equal(summary.effective.autoRouteHigh, "opus");
		assert.equal(summary.aliasCount, 7);
	});

	it("marks summary with a not-found file state when settings are defaults only", () => {
		const settings = mergeSettings();
		const summary = summarizeSettings(settings, "not-found");
		assert.equal(summary.fileState, "not-found");
		assert.equal(summary.effective.maxContextChars, undefined);
	});

	it("flags malformed file state without overwriting effective settings", () => {
		const settings = mergeSettings({ defaultModel: "opus" });
		const summary = summarizeSettings(settings, "malformed");
		assert.equal(summary.fileState, "malformed");
		assert.equal(summary.manualRecoveryPath, true);
		assert.match(summary.manualEditHint, /settings\.json/);
	});

	it("formats the summary as a multi-line text with manual edit path", () => {
		const settings = mergeSettings({
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		const text = formatConfigSummaryText(summarizeSettings(settings, "loaded"), SETTINGS_PATH);
		assert.match(text, /defaultModel: opus/);
		assert.match(text, /autoRouteLow: gpt/);
		assert.match(text, /autoRouteHigh: opus/);
		assert.match(text, /aliases: 7/);
		assert.match(text, /settings\.json/);
	});

	it("serializes settings as formatted manual-editable JSON", () => {
		const text = serializeSettings(
			mergeSettings({
				defaultModel: "mimo",
				maxOutputChars: 1234,
				autoRouteLow: "spark",
			}),
		);
		const parsed = JSON.parse(text) as Record<string, unknown>;
		assert.equal(parsed.defaultModel, "mimo");
		assert.equal(parsed.maxOutputChars, 1234);
		assert.equal(parsed.autoRouteLow, "spark");
		assert.match(text, /\n  "aliases": \{/);
	});

	it("plans settings writes without silently overwriting malformed files", () => {
		const settings = mergeSettings();
		assert.equal(planSettingsWrite(settings, "not-found").canWrite, true);
		assert.equal(planSettingsWrite(settings, "loaded").canWrite, true);
		const malformed = planSettingsWrite(settings, "malformed");
		assert.equal(malformed.canWrite, false);
		assert.match(malformed.reason, /malformed/);
	});
});

describe("interactive config update helpers", () => {
	it("applies validated common setting updates without dropping aliases", () => {
		const settings = mergeSettings({ aliases: { custom: "provider/model" } });
		const updated = applyConfigUpdate(settings, "defaultModel", "custom");
		assert.equal(updated.defaultModel, "custom");
		assert.equal(updated.aliases.custom, "provider/model");
		assert.throws(() => applyConfigUpdate(settings, "defaultModel", ""), /non-empty alias or provider\/model/);
		assert.deepEqual(CONFIG_EDITABLE_FIELDS, [
			"defaultModel",
			"autoRouteLow",
			"autoRouteHigh",
			"defaultMode",
			"defaultBrevity",
			"maxContextChars",
			"maxOutputChars",
		]);
	});

	it("requires auto-route targets to name existing aliases", () => {
		const settings = mergeSettings({ aliases: { spark: "openai-codex/codex-5.3-spark" } });
		assert.equal(applyConfigUpdate(settings, "autoRouteLow", "spark").autoRouteLow, "spark");
		assert.throws(() => applyConfigUpdate(settings, "autoRouteHigh", "missing"), /existing alias/);
	});

	it("validates enum and numeric config updates and allows clearing numeric overrides", () => {
		const settings = mergeSettings({ maxContextChars: 12000, maxOutputChars: 4000 });
		assert.equal(applyConfigUpdate(settings, "defaultMode", "risk-check").defaultMode, "risk-check");
		assert.equal(applyConfigUpdate(settings, "defaultBrevity", "detailed").defaultBrevity, "detailed");
		assert.equal(applyConfigUpdate(settings, "maxContextChars", "1234").maxContextChars, 1234);
		assert.equal(applyConfigUpdate(settings, "maxOutputChars", "").maxOutputChars, undefined);
		assert.throws(() => applyConfigUpdate(settings, "maxOutputChars", "0"), /positive integer/);
	});

	it("formats a concise changed-fields summary for confirmation", () => {
		const before = mergeSettings({ defaultModel: "opus", maxOutputChars: 4000 });
		const after = applyConfigUpdate(before, "maxOutputChars", "2000");
		const summary = formatSettingsChangeSummary(before, after);
		assert.match(summary, /maxOutputChars: 4000 -> 2000/);
		assert.doesNotMatch(summary, /defaultModel/);
	});

	it("wires the interactive config path through UI selection, confirmation, and serialized writes", () => {
		const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
		assert.match(indexSource, /ctx\.hasUI/);
		assert.match(indexSource, /ctx\.ui\.select\("pitaj config"/);
		assert.match(indexSource, /ctx\.ui\.input\(`Enter \$\{field\}`/);
		assert.match(indexSource, /ctx\.ui\.confirm\(\s*"Write pitaj settings\?"/);
		assert.match(indexSource, /writeFileSync\(SETTINGS_PATH, serializeSettings\(updated\), "utf8"\)/);
		assert.match(indexSource, /try \{\s*writeFileSync\(SETTINGS_PATH, serializeSettings\(updated\), "utf8"\);/s);
		assert.match(indexSource, /pitaj config save failed/);
		assert.match(indexSource, /loaded\.fileState === "malformed"/);
		assert.match(indexSource, /Alias editing is manual in M2/);
	});
});

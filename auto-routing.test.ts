import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	PITAJ_AUTO_RISKS,
	mergeSettings,
	resolveAutoRoute,
	resolveModelRef,
} from "./helpers.ts";

describe("pitaj auto routing", () => {
	it("routes high risk to opus with risk-check suggestion when mode omitted", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "high" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: risk=high → opus");
		assert.equal(result.suggestedMode, "risk-check");
	});

	it("routes high risk to opus without suggestion when mode is explicit", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "high", mode: "debug" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: risk=high → opus");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes low risk to gpt without suggestion", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "low" }, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: risk=low → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + risk-check mode to opus", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ mode: "risk-check" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: mode=risk-check → opus");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + debug mode to gpt", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ mode: "debug" }, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: default → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + omitted mode to gpt", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({}, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: default → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("throws when selected gpt alias is blank", () => {
		const settings = mergeSettings({ aliases: { gpt: "", opus: "anthropic/claude-opus-4-8" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "low" }, settings),
			/pitaj auto routing requires a non-empty "gpt" alias/,
		);
	});

	it("throws when selected opus alias is blank", () => {
		const settings = mergeSettings({ aliases: { opus: "", gpt: "openai-codex/gpt-5.5" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "high" }, settings),
			/pitaj auto routing requires a non-empty "opus" alias/,
		);
	});

	it("rejects invalid runtime risk hints", () => {
		const settings = mergeSettings();
		assert.throws(
			() => resolveAutoRoute({ risk: "medium" as never }, settings),
			/Unknown pitaj auto risk "medium"/,
		);
	});

	it("keeps manual model resolution separate from auto routing hints", () => {
		const settings = mergeSettings();
		assert.deepEqual([...PITAJ_AUTO_RISKS], ["low", "high"]);
		assert.equal(resolveModelRef("gpt", settings).alias, "gpt");
		assert.equal(resolveModelRef("mimo/mimo-v2.5-pro", settings).resolved, "mimo/mimo-v2.5-pro");
	});
});

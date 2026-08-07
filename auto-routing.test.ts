import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	PITAJ_AUTO_RISKS,
	mergeSettings,
	parseAutoCommandArgs,
	resolveAutoRoute,
	resolveModelRef,
} from "./helpers.ts";
import pitaj from "./index.ts";

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

	it("routes a parsed top-level risk flag through the same auto router", () => {
		const settings = mergeSettings();
		const high = parseAutoCommandArgs("--risk high Is this architecture safe?", settings);
		assert.equal(resolveAutoRoute({ risk: high.risk, mode: high.mode }, settings).alias, "opus");

		const low = parseAutoCommandArgs("--mode debug --risk low check this assertion", settings);
		assert.equal(resolveAutoRoute({ risk: low.risk, mode: low.mode }, settings).alias, "gpt");
	});

	it("does not route on quoted risk text", () => {
		const settings = mergeSettings();
		const parsed = parseAutoCommandArgs('-c "--risk high" what breaks?', settings);
		assert.equal(resolveAutoRoute({ risk: parsed.risk, mode: parsed.mode }, settings).alias, "gpt");
	});

	it("rejects a malformed risk flag before starting any consult", async () => {
		for (const [args, expected] of [
			["auto --risk low --risk high which one?", /--risk was given more than once/],
			["auto --risk medium why?", /must be 'low' or 'high'/],
			["auto is this safe? --risk", /--risk requires a value/],
		] as const) {
			const notifications: string[] = [];
			let handler: ((commandArgs: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
			const api = {
				on() {},
				registerTool() {},
				registerCommand(_name: string, options: { handler: typeof handler }) {
					handler = options.handler;
				},
			} as unknown as ExtensionAPI;
			pitaj(api);
			if (!handler) throw new Error("pitaj did not register its command");

			const ctx = {
				hasUI: false,
				ui: {
					notify(message: string) {
						notifications.push(message);
					},
					setStatus() {},
				},
				modelRegistry: {
					find() {
						throw new Error("no consult may start for a malformed risk flag");
					},
				},
			} as unknown as ExtensionCommandContext;

			await handler(args, ctx);
			assert.ok(
				notifications.some((message) => expected.test(message)),
				`expected ${expected} in ${JSON.stringify(notifications)}`,
			);
			assert.ok(!notifications.some((message) => /pitaj auto failed/.test(message)));
		}
	});

	it("keeps manual model resolution separate from auto routing hints", () => {
		const settings = mergeSettings();
		assert.deepEqual([...PITAJ_AUTO_RISKS], ["low", "high"]);
		assert.equal(resolveModelRef("gpt", settings).alias, "gpt");
		assert.equal(resolveModelRef("mimo/mimo-v2.5-pro", settings).resolved, "mimo/mimo-v2.5-pro");
	});
});

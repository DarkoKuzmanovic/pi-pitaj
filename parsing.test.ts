import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	mergeSettings,
	parseAutoCommandArgs,
	parseCommandArgs,
} from "./helpers.ts";

describe("pitaj command parsing", () => {
	it("parses /pitaj opus question text", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("opus should we do this?", settings), {
			model: "opus",
			question: "should we do this?",
			mode: undefined,
			brevity: undefined,
			context: undefined,
		});
	});

	it("uses the default model when the first word is not a model", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("should we do this?", settings), {
			model: undefined,
			question: "should we do this?",
			mode: undefined,
			brevity: undefined,
			context: undefined,
		});
	});
});

describe("pitaj flag parsing", () => {
	it("parses --mode and --brevity flags", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("opus --mode risk-check --brevity detailed is this safe?", settings), {
			model: "opus",
			question: "is this safe?",
			mode: "risk-check",
			brevity: "detailed",
			context: undefined,
		});
	});

	it("parses -c flag for context", () => {
		const settings = mergeSettings({ aliases: { deepseek: "deepseek/deepseek-v4-pro" } });
		assert.deepEqual(parseCommandArgs("deepseek -c some-context what edge cases?", settings), {
			model: "deepseek",
			question: "what edge cases?",
			mode: undefined,
			brevity: undefined,
			context: "some-context",
		});
	});

	it("parses -c flag with quoted multi-word context", () => {
		const settings = mergeSettings({ aliases: { deepseek: "deepseek/deepseek-v4-pro" } });
		assert.deepEqual(parseCommandArgs('deepseek -c "Feature: bulk upload" what edge cases?', settings), {
			model: "deepseek",
			question: "what edge cases?",
			mode: undefined,
			brevity: undefined,
			context: "Feature: bulk upload",
		});
	});

	it("ignores unknown flag values in question", () => {
		const settings = mergeSettings({ aliases: {} });
		const result = parseCommandArgs("--mode random stuff here", settings);
		assert.equal(result.mode, undefined);
		assert.equal(result.question, "--mode random stuff here");
	});

	it("leaves literal risk text alone in ordinary consults", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		const result = parseCommandArgs("opus what does --risk high mean?", settings);
		assert.equal(result.model, "opus");
		assert.equal(result.question, "what does --risk high mean?");
		assert.equal((result as { risk?: string }).risk, undefined);
	});
});

describe("pitaj auto risk flag parsing", () => {
	const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8", gpt: "openai-codex/gpt-5.5" } });

	it("parses a top-level risk flag and keeps the question intact", () => {
		const parsed = parseAutoCommandArgs("--risk high Is this architecture safe?", settings);
		assert.equal(parsed.risk, "high");
		assert.equal(parsed.question, "Is this architecture safe?");
	});

	it("accepts risk flags before and after other flags", () => {
		const before = parseAutoCommandArgs("--risk low --mode debug Check this assertion", settings);
		assert.equal(before.risk, "low");
		assert.equal(before.mode, "debug");
		assert.equal(before.question, "Check this assertion");

		const after = parseAutoCommandArgs("--mode debug --brevity detailed --risk low Check this assertion", settings);
		assert.equal(after.risk, "low");
		assert.equal(after.mode, "debug");
		assert.equal(after.brevity, "detailed");
		assert.equal(after.question, "Check this assertion");
	});

	it("normalizes the risk value case", () => {
		assert.equal(parseAutoCommandArgs("--RISK High why?", settings).risk, "high");
	});

	it("omits risk when no flag is present", () => {
		const parsed = parseAutoCommandArgs("should we do this?", settings);
		assert.equal(parsed.risk, undefined);
		assert.equal(parsed.question, "should we do this?");
	});

	it("keeps quoted risk text inside context instead of routing on it", () => {
		const parsed = parseAutoCommandArgs('-c "--risk high stays here" is this ok?', settings);
		assert.equal(parsed.risk, undefined);
		assert.equal(parsed.context, "--risk high stays here");
		assert.equal(parsed.question, "is this ok?");
	});

	it("keeps a quoted standalone risk literal in context", () => {
		const parsed = parseAutoCommandArgs('-c "--risk" high what?', settings);
		assert.equal(parsed.risk, undefined);
		assert.equal(parsed.context, "--risk");
		assert.equal(parsed.question, "high what?");
	});

	it("keeps a quoted standalone risk literal inside the question", () => {
		const parsed = parseAutoCommandArgs('what does "--risk" high mean?', settings);
		assert.equal(parsed.risk, undefined);
		assert.equal(parsed.question, "what does --risk high mean?");
	});

	it("does not let a risk flag clobber a separate context flag", () => {
		const parsed = parseAutoCommandArgs('--risk high -c "bulk upload feature" what breaks?', settings);
		assert.equal(parsed.risk, "high");
		assert.equal(parsed.context, "bulk upload feature");
		assert.equal(parsed.question, "what breaks?");
	});

	it("rejects duplicate top-level risk flags", () => {
		assert.throws(
			() => parseAutoCommandArgs("--risk low --risk high which one?", settings),
			/--risk was given more than once/,
		);
	});

	it("rejects a missing risk value", () => {
		assert.throws(() => parseAutoCommandArgs("--risk", settings), /--risk requires a value/);
		assert.throws(() => parseAutoCommandArgs("is this safe? --risk", settings), /--risk requires a value/);
	});

	it("rejects an invalid risk value", () => {
		assert.throws(() => parseAutoCommandArgs("--risk medium why?", settings), /must be 'low' or 'high'/);
	});
});

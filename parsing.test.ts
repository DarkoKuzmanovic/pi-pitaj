import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	mergeSettings,
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
});

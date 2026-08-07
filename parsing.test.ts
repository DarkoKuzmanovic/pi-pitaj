import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	classifySpecialCommand,
	mergeSettings,
	parseAutoCommandArgs,
	parseCommandArgs,
} from "./helpers.ts";
import pitaj from "./index.ts";

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

describe("pitaj quote-aware lexer", () => {
	const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8", gpt: "openai-codex/gpt-5.5" } });

	it("treats every JavaScript whitespace separator outside quotes as a token boundary", () => {
		const parsed = parseCommandArgs("opus\t--mode\ndebug\u00a0--brevity\rdetailed\twhy is this slow?", settings);
		assert.equal(parsed.model, "opus");
		assert.equal(parsed.mode, "debug");
		assert.equal(parsed.brevity, "detailed");
		assert.equal(parsed.question, "why is this slow?");
	});

	it("keeps whitespace inside a quoted context value", () => {
		const parsed = parseCommandArgs('opus -c "line one\nline two" what now?', settings);
		assert.equal(parsed.context, "line one\nline two");
		assert.equal(parsed.question, "what now?");
	});

	it("supports escaped quotes and escaped backslashes inside a quoted value", () => {
		const parsed = parseCommandArgs('opus -c "say \\"hi\\" then C:\\\\tmp" what now?', settings);
		assert.equal(parsed.context, 'say "hi" then C:\\tmp');
		assert.equal(parsed.question, "what now?");
	});

	it("never reads a quoted flag as top-level syntax", () => {
		const parsed = parseCommandArgs('opus "--mode" debug what does it do?', settings);
		assert.equal(parsed.mode, undefined);
		assert.equal(parsed.question, "--mode debug what does it do?");
	});

	it("never reads a quoted alias as the model", () => {
		const parsed = parseCommandArgs('"opus" is a model name, right?', settings);
		assert.equal(parsed.model, undefined);
		assert.equal(parsed.question, "opus is a model name, right?");
	});

	it("falls back deterministically on an unbalanced quote", () => {
		const first = parseCommandArgs('opus "what is wrong here?', settings);
		const second = parseCommandArgs('opus "what is wrong here?', settings);
		assert.deepEqual(first, second);
		assert.equal(first.model, "opus");
		assert.equal(first.question, '"what is wrong here?');
		assert.equal(first.context, undefined);
	});

	it("rejects duplicate top-level mode, brevity, and context flags", () => {
		assert.throws(() => parseCommandArgs("opus --mode debug --mode plan which?", settings), /--mode was given more than once/);
		assert.throws(
			() => parseCommandArgs("opus --brevity short -b detailed which?", settings),
			/--brevity was given more than once/,
		);
		assert.throws(() => parseCommandArgs("opus -c one --context two which?", settings), /--context was given more than once/);
	});

	it("rejects duplicate flags in auto commands through the same lexer", () => {
		assert.throws(
			() => parseAutoCommandArgs("--risk low --mode debug -m plan which?", settings),
			/--mode was given more than once/,
		);
	});

	it("still accepts a single quoted duplicate-looking flag as literal text", () => {
		const parsed = parseCommandArgs('opus --mode debug "--mode" plan which?', settings);
		assert.equal(parsed.mode, "debug");
		assert.equal(parsed.question, "--mode plan which?");
	});
});

describe("special command classification uses the shared lexical model", () => {
	it("classifies subcommands separated by any whitespace", () => {
		assert.equal(classifySpecialCommand("auto\t--risk high why?"), "auto");
		assert.equal(classifySpecialCommand("advise\nwhy?"), "advise");
		assert.equal(classifySpecialCommand("config\tshow"), "config");
		assert.equal(classifySpecialCommand("usage\treset"), "usage");
	});

	it("does not classify a quoted subcommand name as a subcommand", () => {
		assert.equal(classifySpecialCommand('"auto" what does it do?'), "none");
		assert.equal(classifySpecialCommand('"help"'), "none");
	});
});

type PitajCommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

/** Register the extension and return the executable `/pitaj` command handler. */
function registeredPitajCommand(): PitajCommandHandler {
	let handler: PitajCommandHandler | undefined;
	const api = {
		on() {},
		registerTool() {},
		sendMessage() {},
		registerCommand(name: string, spec: { handler: PitajCommandHandler }) {
			if (name === "pitaj") handler = spec.handler;
		},
	} as unknown as ExtensionAPI;
	pitaj(api);
	if (!handler) throw new Error("pitaj did not register its /pitaj command");
	return handler;
}

function notifyingCtx(notes: string[]): ExtensionContext {
	return {
		hasUI: false,
		ui: {
			notify(text: string) {
				notes.push(text);
			},
			setStatus() {},
			async editor() {
				return undefined;
			},
		},
		modelRegistry: {
			find() {
				return undefined;
			},
			async getApiKeyAndHeaders() {
				return { ok: false, error: "no credentials in this fixture" };
			},
		},
	} as unknown as ExtensionContext;
}

describe("special command execution consumes the classified tokens", () => {
	it("resets usage counters for any JavaScript whitespace separator", async () => {
		for (const input of ["usage reset", "usage\treset", "usage\nreset", "USAGE  RESET"]) {
			const notes: string[] = [];
			await registeredPitajCommand()(input, notifyingCtx(notes));
			assert.deepEqual(notes, ["pitaj usage counters reset"], `input: ${JSON.stringify(input)}`);
		}
	});

	it("renders the usage summary for a bare usage subcommand", async () => {
		const notes: string[] = [];
		await registeredPitajCommand()("usage", notifyingCtx(notes));
		assert.equal(notes.length, 1);
		assert.match(notes[0], /pitaj usage \(current session\)/);
	});

	it("never treats a quoted reset as usage syntax", async () => {
		const notes: string[] = [];
		await registeredPitajCommand()('usage "reset"', notifyingCtx(notes));
		assert.equal(notes.length, 1);
		assert.doesNotMatch(notes[0], /counters reset/);
		// Quoted text is an ordinary question, so it reaches the consult path.
		assert.match(notes[0], /pitaj failed:/);
	});

	it("shows the config summary for any whitespace-separated show subcommand", async () => {
		for (const input of ["config show", "config\tshow", "CONFIG\nSHOW"]) {
			const notes: string[] = [];
			await registeredPitajCommand()(input, notifyingCtx(notes));
			assert.equal(notes.length, 1, `input: ${JSON.stringify(input)}`);
			assert.match(notes[0], /pitaj config \(/);
			assert.doesNotMatch(notes[0], /Unsupported \/pitaj config subcommand/, `input: ${JSON.stringify(input)}`);
		}
	});

	it("shows the config summary without a UI for a bare config subcommand", async () => {
		const notes: string[] = [];
		await registeredPitajCommand()("config", notifyingCtx(notes));
		assert.equal(notes.length, 1);
		assert.match(notes[0], /pitaj config \(/);
		assert.doesNotMatch(notes[0], /Unsupported \/pitaj config subcommand/);
	});

	it("reports an unsupported config subcommand, including a quoted show", async () => {
		for (const input of ["config bogus", 'config "show"', "config show extra"]) {
			const notes: string[] = [];
			await registeredPitajCommand()(input, notifyingCtx(notes));
			assert.equal(notes.length, 1, `input: ${JSON.stringify(input)}`);
			assert.match(notes[0], /Unsupported \/pitaj config subcommand/, `input: ${JSON.stringify(input)}`);
		}
	});
});

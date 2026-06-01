import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stream, StringEnum, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildConsultSystemPrompt,
	buildConsultUserText,
	CONFIG_EDITABLE_FIELDS,
	DEFAULT_MAX_CONTEXT_CHARS,
	applyConfigUpdate,
	formatConfigSummaryText,
	formatSettingsChangeSummary,
	mergeSettings,
	planSettingsWrite,
	parseCommandArgs,
	serializeSettings,
	PITAJ_AUTO_RISKS,
	PITAJ_BREVITIES,
	PITAJ_MODES,
	classifySpecialCommand,
	resolveAutoRoute,
	resolveMaxOutputChars,
	resolveModelRef,
	settingsFromUnknown,
	summarizeSettings,
	type PitajSettingsFileState,
	type ConfigEditableField,
	truncateText,
	type PitajAutoRisk,
	type PitajBrevity,
	type PitajMode,
	type PitajSettings,
	type ParsedCommandArgs,
} from "./helpers.ts";
import { buildRuntimeSnapshotInput, SnapshotToolResultBuffer, registerSnapshotToolResultCapture, type SnapshotRuntimeSessionManager } from "./snapshot-runtime.ts";
import { buildSnapshotContext, type SnapshotCategory, type SnapshotCategoryMetadata } from "./snapshot.ts";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(EXTENSION_DIR, "settings.json");

interface LoadedSettings {
	settings: PitajSettings;
	warning?: string;
	fileState: PitajSettingsFileState;
}

interface PitajRequest {
	model?: string;
	mode?: PitajMode;
	risk?: PitajAutoRisk;
	question: string;
	context?: string;
	brevity?: PitajBrevity;
	maxContextChars?: number;
	maxOutputChars?: number;
}

interface PitajResultDetails {
	model: string;
	alias?: string;
	mode: PitajMode;
	brevity: PitajBrevity;
	question: string;
	contextChars: number;
	answerChars: number;
	durationMs: number;
	settingsPath: string;
	settingsWarning?: string;
	stopReason?: string;
	autoRouted?: boolean;
	routingReason?: string;
	autoSuggestedMode?: PitajMode;
	snapshot?: PitajSnapshotDetails;
}

export interface PitajSnapshotDetails {
	used: true;
	includedCategories: SnapshotCategory[];
	truncatedCategories: SnapshotCategory[];
	omittedCategories: SnapshotCategory[];
	truncated: boolean;
	contextChars: number;
	metadata: SnapshotCategoryMetadata[];
}

export interface SnapshotCommandRequestResult {
	request: PitajRequest;
	snapshot: PitajSnapshotDetails;
}

interface SnapshotCommandRuntime {
	sessionManager?: SnapshotRuntimeSessionManager;
	toolResults?: SnapshotToolResultBuffer;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function loadSettings(): LoadedSettings {
	if (!existsSync(SETTINGS_PATH)) {
		return { settings: mergeSettings(), fileState: "not-found" };
	}

	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as unknown;
		return { settings: mergeSettings(settingsFromUnknown(parsed)), fileState: "loaded" };
	} catch (error) {
		return {
			settings: mergeSettings(),
			fileState: "malformed",
			warning: `Could not read pitaj settings.json; using built-in defaults. ${errorMessage(error)}`,
		};
	}
}

function formatAliasList(settings: PitajSettings): string {
	const lines = Object.entries(settings.aliases)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([alias, target]) => `  ${alias} -> ${target}`);
	return [`pitaj aliases (${SETTINGS_PATH}):`, ...lines].join("\n");
}

function usageText(): string {
	return [
		"Usage:",
		"  /pitaj <question>",
		"  /pitaj <alias|provider/model> [--mode <mode>] [--brevity <level>] [-c <context>] <question>",
		"  /pitaj snapshot <question>",
		"  /pitaj snapshot <alias|provider/model> [--mode <mode>] [--brevity <level>] <question>",
		"  /pitaj aliases",
		"  /pitaj models",
		"  /pitaj check",
		"  /pitaj config",
		"  /pitaj help",
		"",
		"Options:",
		"  -m, --mode      answer | critique | debug | plan | risk-check",
		"  -b, --brevity   short | normal | detailed",
		"  -c, --context   bounded context for the sidecar model",
		"  snapshot       build a bounded session snapshot for the sidecar; no full-branch capture or tools",
		"  config         show effective settings; with UI, edit common settings after confirmation",
		"",
		"Tool auto-routing: use model=\"auto\" with risk=\"low\"|\"high\". Snapshot mode is slash-command only.",
		"",
		"Examples:",
		"  /pitaj should we do this now?",
		"  /pitaj opus review for edge cases",
		"  /pitaj opus --mode risk-check --brevity detailed is this safe?",
		"  /pitaj snapshot should we change this design?",
		"  /pitaj snapshot opus --mode risk-check --brevity detailed is this safe?",
		"  /pitaj deepseek -c \"Feature: bulk upload\" what edge cases?",
		"  /pitaj aliases",
		"  /pitaj config",
	].join("\n");
}

function getTextContent(message: Message): string {
	return message.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}

async function consultModel(
	request: PitajRequest,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	loaded?: LoadedSettings,
	onUpdate?: (update: { content: { type: "text"; text: string }[] }) => void,
): Promise<{ answer: string; details: PitajResultDetails }> {
	const resolvedLoaded = loaded ?? loadSettings();
	const settings = resolvedLoaded.settings;
	const question = request.question.trim();
	if (!question) {
		throw new Error("pitaj needs a question.");
	}
	const autoRoute = request.model?.trim().toLowerCase() === "auto"
		? resolveAutoRoute({ risk: request.risk, mode: request.mode }, settings)
		: undefined;
	const resolved = resolveModelRef(autoRoute?.alias ?? request.model, settings);
	const model = ctx.modelRegistry.find(resolved.provider, resolved.modelId);
	if (!model) {
		throw new Error(
			`pitaj model is not registered: ${resolved.resolved}. Check ${SETTINGS_PATH} or run /model to confirm the provider/model id.`,
		);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key for ${resolved.resolved}` : auth.error);
	}

	const mode = request.mode ?? autoRoute?.suggestedMode ?? settings.defaultMode;
	const brevity = request.brevity ?? settings.defaultBrevity;
	const maxContextChars = request.maxContextChars ?? settings.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
	const maxOutputChars = resolveMaxOutputChars(request.maxOutputChars, settings, brevity);
	const context = request.context?.trim();
	const userText = buildConsultUserText(question, context, maxContextChars);
	const startedAt = Date.now();

	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: startedAt,
	};

	const streamResponse = stream(
		model,
		{
			systemPrompt: buildConsultSystemPrompt(mode, brevity),
			messages: [userMessage],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, signal },
	);

	let accumulatedText = "";
	try {
		for await (const event of streamResponse) {
			if (event.type === "text_delta") {
				accumulatedText += event.delta;
				onUpdate?.({ content: [{ type: "text", text: accumulatedText }] });
			}
		}
	} catch {
		// If streaming fails, result() still contains the partial/error response
	}
	const response = await streamResponse.result();

	if (response.stopReason === "aborted") {
		throw new Error("pitaj consult was aborted.");
	}

	const rawAnswer = getTextContent({
		role: "assistant",
		content: response.content,
		timestamp: Date.now(),
	});
	const answer = truncateText(rawAnswer.trim() || "(pitaj returned no text)", maxOutputChars);

	return {
		answer,
		details: {
			model: resolved.resolved,
			...(resolved.alias ? { alias: resolved.alias } : {}),
			mode,
			brevity,
			question,
			contextChars: context?.length ?? 0,
			answerChars: answer.length,
			durationMs: Date.now() - startedAt,
			settingsPath: SETTINGS_PATH,
			...(resolvedLoaded.warning ? { settingsWarning: resolvedLoaded.warning } : {}),
			...(response.stopReason ? { stopReason: response.stopReason } : {}),
			...(autoRoute ? { autoRouted: true, routingReason: autoRoute.routingReason } : {}),
			...(autoRoute?.suggestedMode ? { autoSuggestedMode: autoRoute.suggestedMode } : {}),
		},
	};
}
async function runCheck(settings: PitajSettings, ctx: ExtensionContext): Promise<void> {
	const entries = Object.entries(settings.aliases).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) {
		ctx.ui.notify("pitaj has no aliases configured.", "info");
		return;
	}

	const lines: string[] = ["pitaj alias check:", ""];
	let allOk = true;

	for (const [alias, target] of entries) {
		let resolved: ReturnType<typeof resolveModelRef>;
		try {
			resolved = resolveModelRef(alias, settings);
		} catch {
			lines.push(`  ✗ ${alias} -> ${target} (bad target)`);
			allOk = false;
			continue;
		}

		const model = ctx.modelRegistry.find(resolved.provider, resolved.modelId);
		if (!model) {
			lines.push(`  ✗ ${alias} -> ${resolved.resolved} (not registered)`);
			allOk = false;
			continue;
		}

		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				lines.push(`  ✗ ${alias} -> ${resolved.resolved} (no API key)`);
				allOk = false;
			} else {
				lines.push(`  ✓ ${alias} -> ${resolved.resolved}`);
			}
		} catch {
			lines.push(`  ✗ ${alias} -> ${resolved.resolved} (auth check failed)`);
			allOk = false;
		}
	}

	ctx.ui.notify(lines.join("\n"), allOk ? "info" : "warning");
}

const CONFIG_FIELD_LABELS: Record<ConfigEditableField, string> = {
	defaultModel: "defaultModel",
	autoRouteLow: "autoRouteLow",
	autoRouteHigh: "autoRouteHigh",
	defaultMode: "defaultMode",
	defaultBrevity: "defaultBrevity",
	maxContextChars: "maxContextChars",
	maxOutputChars: "maxOutputChars",
};

function configFieldOption(field: ConfigEditableField, settings: PitajSettings): string {
	const current = settings[field] === undefined ? "default" : String(settings[field]);
	return `Set ${CONFIG_FIELD_LABELS[field]} (current: ${current})`;
}

function fieldFromConfigOption(option: string, settings: PitajSettings): ConfigEditableField | undefined {
	return CONFIG_EDITABLE_FIELDS.find((field) => option === configFieldOption(field, settings));
}

async function promptConfigValue(ctx: ExtensionContext, settings: PitajSettings, field: ConfigEditableField): Promise<string | undefined> {
	if (field === "autoRouteLow" || field === "autoRouteHigh") {
		const aliases = Object.keys(settings.aliases).sort((a, b) => a.localeCompare(b));
		return ctx.ui.select(`Choose ${field} alias`, aliases);
	}
	if (field === "defaultMode") return ctx.ui.select("Choose default mode", [...PITAJ_MODES]);
	if (field === "defaultBrevity") return ctx.ui.select("Choose default brevity", [...PITAJ_BREVITIES]);
	const current = settings[field] === undefined ? "" : String(settings[field]);
	const hint = field === "maxContextChars" || field === "maxOutputChars" ? "blank/default/clear uses the built-in default" : current;
	return ctx.ui.input(`Enter ${field}`, hint);
}

async function runConfigUi(loaded: LoadedSettings, ctx: ExtensionContext): Promise<void> {
	const summary = summarizeSettings(loaded.settings, loaded.fileState);
	if (loaded.fileState === "malformed") {
		ctx.ui.notify(
			`${formatConfigSummaryText(summary, SETTINGS_PATH)}\n\nsettings.json is malformed; refusing to overwrite it from the config UI. Fix the file manually, then rerun /pitaj config.`,
			"warning",
		);
		return;
	}

	const options = [
		"Show summary",
		...CONFIG_EDITABLE_FIELDS.map((field) => configFieldOption(field, loaded.settings)),
		"Alias editing instructions",
		"Cancel",
	];
	const choice = await ctx.ui.select("pitaj config", options);
	if (!choice || choice === "Cancel") {
		ctx.ui.notify("pitaj config cancelled", "info");
		return;
	}
	if (choice === "Show summary") {
		ctx.ui.notify(formatConfigSummaryText(summary, SETTINGS_PATH), "info");
		return;
	}
	if (choice === "Alias editing instructions") {
		ctx.ui.notify(
			`${formatConfigSummaryText(summary, SETTINGS_PATH)}\n\nAlias editing is manual in M2. Edit settings.json directly, then rerun /pitaj check.`,
			"info",
		);
		return;
	}

	const field = fieldFromConfigOption(choice, loaded.settings);
	if (!field) {
		ctx.ui.notify("Unknown pitaj config option", "warning");
		return;
	}
	const value = await promptConfigValue(ctx, loaded.settings, field);
	if (value === undefined) {
		ctx.ui.notify("pitaj config cancelled", "info");
		return;
	}

	let updated: PitajSettings;
	try {
		updated = applyConfigUpdate(loaded.settings, field, value);
	} catch (error) {
		ctx.ui.notify(`pitaj config invalid value: ${errorMessage(error)}`, "warning");
		return;
	}

	const changes = formatSettingsChangeSummary(loaded.settings, updated);
	if (changes === "No settings changes.") {
		ctx.ui.notify(changes, "info");
		return;
	}

	const writePlan = planSettingsWrite(updated, loaded.fileState);
	if (!writePlan.canWrite) {
		ctx.ui.notify(`${writePlan.reason}\n\n${formatConfigSummaryText(summary, SETTINGS_PATH)}`, "warning");
		return;
	}

	const confirmed = await ctx.ui.confirm(
		"Write pitaj settings?",
		`${changes}\n\n${writePlan.reason}\nPath: ${SETTINGS_PATH}`,
	);
	if (!confirmed) {
		ctx.ui.notify("pitaj config changes not saved", "info");
		return;
	}

	try {
		writeFileSync(SETTINGS_PATH, serializeSettings(updated), "utf8");
	} catch (error) {
		ctx.ui.notify(`pitaj config save failed: ${errorMessage(error)}`, "error");
		return;
	}
	ctx.ui.notify(`pitaj settings saved\n${changes}`, "info");
}

function formatResultForDisplay(answer: string, details: PitajResultDetails): string {
	const alias = details.alias ? ` (${details.alias})` : "";
	return [`pitaj ${details.model}${alias}`, "", answer].join("\n");
}

export function parseSnapshotCommandArgs(args: string, settings: PitajSettings): ParsedCommandArgs | undefined {
	const trimmed = args.trim();
	const normalized = trimmed.toLowerCase();
	if (normalized === "snapshot") {
		return parseCommandArgs("", settings);
	}
	if (!normalized.startsWith("snapshot ")) {
		return undefined;
	}
	return parseCommandArgs(trimmed.slice("snapshot".length).trim(), settings);
}

export function buildSnapshotCommandRequest(
	parsed: ParsedCommandArgs,
	settings: PitajSettings,
	runtime: SnapshotCommandRuntime,
): SnapshotCommandRequestResult {
	const customCategories = parsed.context
		? [
				{
					category: "active-plan" as const,
					title: "Caller-provided context",
					content: parsed.context,
					sourceKind: "caller" as const,
					sourceLabel: "-c/--context",
				},
			]
		: undefined;
	const snapshotInput = buildRuntimeSnapshotInput({
		question: parsed.question,
		maxContextChars: settings.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
		sessionManager: runtime.sessionManager,
		toolResults: runtime.toolResults,
		customCategories,
	});
	const snapshot = buildSnapshotContext(snapshotInput);
	const includedCategories = snapshot.metadata.filter((item) => item.status === "included").map((item) => item.category);
	const truncatedCategories = snapshot.metadata.filter((item) => item.status === "truncated").map((item) => item.category);

	return {
		request: {
			model: parsed.model,
			question: parsed.question,
			mode: parsed.mode,
			brevity: parsed.brevity,
			context: snapshot.context,
		},
		snapshot: {
			used: true,
			includedCategories,
			truncatedCategories,
			omittedCategories: snapshot.omittedCategories,
			truncated: snapshot.truncated,
			contextChars: snapshot.context.length,
			metadata: snapshot.metadata,
		},
	};
}
const PitajParams = Type.Object({
	model: Type.Optional(
		Type.String({
			description:
				"Model alias (opus, gpt, mimo, deepseek, glm), explicit provider/model, or 'auto' for built-in routing."
		}),
	),
	mode: Type.Optional(
		StringEnum(PITAJ_MODES, {
			description: "Consult style. answer=direct, critique=adversarial review, debug=bug analysis, plan=steps, risk-check=risks.",
			default: "answer",
		}),
	),
	risk: Type.Optional(
		StringEnum(PITAJ_AUTO_RISKS, {
			description:
				"Routing hint for model auto. low=bounded technical check; high=architecture, security, data integrity, or hard-to-reverse change. Only used when model is auto.",
		})),
	question: Type.String({
		description: "The specific question to ask pitaj. Keep it focused for speed.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Optional bounded context to provide to the sidecar model. Do not paste huge logs; summarize first.",
		}),
	),
	brevity: Type.Optional(
		StringEnum(PITAJ_BREVITIES, {
			description: "How much detail pitaj should return.",
			default: "short",
		}),
	),
	maxContextChars: Type.Optional(
		Type.Number({
			description: "Maximum characters of optional context to send. Defaults to settings.json maxContextChars.",
			minimum: 1,
		}),
	),
	maxOutputChars: Type.Optional(
		Type.Number({
			description: "Maximum characters to return to the current model. Defaults to settings.json maxOutputChars.",
			minimum: 1,
		}),
	),
});

export default function pitaj(pi: ExtensionAPI): void {
	const snapshotToolResults = new SnapshotToolResultBuffer();
	registerSnapshotToolResultCapture(pi, snapshotToolResults);
	pi.registerTool({
		name: "pitaj",
		label: "Pitaj",
		description:
			"Ask another model for a fast in-process consultation without spawning a subagent or starting a new Pi session.",
		promptSnippet: "Ask another model for fast in-current-session advice",
		promptGuidelines: [
			"Use pitaj with model:'auto', risk:'low' for bounded technical questions: debug, API uncertainty, syntax check, localized code review.",
			"Use pitaj with model:'auto', risk:'high' for architectural decisions, security, data-integrity concerns, or hard-to-reverse changes.",
			"Use explicit aliases (model:'opus', model:'gpt') when you already know which model you need.",
			"Do not use pitaj for simple facts you can verify locally with read, grep, or bash.",
			"pitaj is a sidecar consultation, not a subagent. It has no tools and cannot inspect files unless you provide context.",
		],
		parameters: PitajParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "pitaj is asking..." }] });
			const loaded = loadSettings();
			const result = await consultModel(params, ctx, signal, loaded, onUpdate);
			return {
				content: [{ type: "text", text: result.answer }],
				details: result.details,
			};
		},
	});

	pi.registerCommand("pitaj", {
		description: "Ask another configured model inline. Usage: /pitaj [help|aliases|alias|provider/model] <question>",
		handler: async (args, ctx) => {
			const loaded = loadSettings();
			if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");

			const trimmed = args.trim();
			const specialCommand = classifySpecialCommand(trimmed);
			if (specialCommand === "help") {
				ctx.ui.notify(usageText(), "info");
				return;
			}

			if (specialCommand === "aliases" || specialCommand === "models") {
				ctx.ui.notify(formatAliasList(loaded.settings), "info");
				return;
			}

			if (specialCommand === "check") {
				await runCheck(loaded.settings, ctx);
				return;
			}

			if (specialCommand === "config") {
				const normalizedConfig = trimmed.toLowerCase();
				const summary = summarizeSettings(loaded.settings, loaded.fileState);
				if (normalizedConfig === "config" && ctx.hasUI) {
					await runConfigUi(loaded, ctx);
					return;
				}
				const prefix = normalizedConfig !== "config" && normalizedConfig !== "config show" ? "Unsupported /pitaj config subcommand. Use /pitaj config for the UI or /pitaj config show for summary.\n\n" : "";
				ctx.ui.notify(`${prefix}${formatConfigSummaryText(summary, SETTINGS_PATH)}`, loaded.fileState === "malformed" ? "warning" : "info");
				return;
			}

			const snapshotParsed = parseSnapshotCommandArgs(trimmed, loaded.settings);
			if (snapshotParsed) {
				let question = snapshotParsed.question;
				if (!question && ctx.hasUI) {
					const label = snapshotParsed.model ? `Question for pitaj snapshot ${snapshotParsed.model}` : "Question for pitaj snapshot";
					const edited = await ctx.ui.editor(label, "");
					if (edited === undefined) {
						ctx.ui.notify("pitaj snapshot cancelled", "info");
						return;
					}
					question = edited.trim();
				}

				if (!question) {
					ctx.ui.notify(usageText(), "info");
					return;
				}

				const snapshotRequest = buildSnapshotCommandRequest(
					{ ...snapshotParsed, question },
					loaded.settings,
					{ sessionManager: ctx.sessionManager, toolResults: snapshotToolResults },
				);

				ctx.ui.setStatus("pitaj snapshot", "asking...");
				try {
					const result = await consultModel(snapshotRequest.request, ctx, undefined, loaded);
					const details = { ...result.details, snapshot: snapshotRequest.snapshot };
					pi.sendMessage({
						customType: "pitaj",
						content: formatResultForDisplay(result.answer, details),
						display: true,
						details,
					});
					ctx.ui.notify(`pitaj snapshot answered with ${result.details.model}`, "info");
				} catch (error) {
					ctx.ui.notify(`pitaj snapshot failed: ${errorMessage(error)}`, "error");
				} finally {
					ctx.ui.setStatus("pitaj snapshot", undefined);
				}
				return;
			}

			const parsed = parseCommandArgs(trimmed, loaded.settings);
			let question = parsed.question;
			if (!question && ctx.hasUI) {
				const label = parsed.model ? `Question for pitaj ${parsed.model}` : "Question for pitaj";
				const edited = await ctx.ui.editor(label, "");
				if (edited === undefined) {
					ctx.ui.notify("pitaj cancelled", "info");
					return;
				}
				question = edited.trim();
			}

			if (!question) {
				ctx.ui.notify(usageText(), "info");
				return;
			}

			ctx.ui.setStatus("pitaj", "asking...");
			try {
				const result = await consultModel(
					{
						model: parsed.model,
						question,
						mode: parsed.mode,
						brevity: parsed.brevity,
						context: parsed.context,
					},
					ctx,
					undefined,
					loaded,
				);
				pi.sendMessage({
					customType: "pitaj",
					content: formatResultForDisplay(result.answer, result.details),
					display: true,
					details: result.details,
				});
				ctx.ui.notify(`pitaj answered with ${result.details.model}`, "info");
			} catch (error) {
				ctx.ui.notify(`pitaj failed: ${errorMessage(error)}`, "error");
			} finally {
				ctx.ui.setStatus("pitaj", undefined);
			}
		},
	});
}

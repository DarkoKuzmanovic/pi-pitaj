import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stream, StringEnum, type AssistantMessage, type Message, type ToolResultMessage } from "@earendil-works/pi-ai";
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
	formatResultForDisplay,
	buildInlineWarnings,
	applyUsageWarningFlags,
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
	isAdviseFlagViolation,
	finalizeConsultAnswer,
	validateAutoRouteAliases,
	type PitajSettings,
	type ParsedCommandArgs,
} from "./helpers.ts";
import { buildRuntimeSnapshotInput, SnapshotToolResultBuffer, registerSnapshotToolResultCapture, type SnapshotRuntimeSessionManager } from "./snapshot-runtime.ts";
import { buildSnapshotContext, type SnapshotCategory, type SnapshotCategoryMetadata } from "./snapshot.ts";
import { createUsageRecorder } from "./usage.ts";
import { PITAJ_EVIDENCE_TOOL, PITAJ_EVIDENCE_TOOL_NAME, approveOracleRoot, executeOracleEvidence } from "./oracle.ts";
import {
	checkEvidenceBudget,
	clampEvidenceRequestOverride,
	consumeEvidenceBudget,
	createOracleBudgetState,
	ORACLE_MAX_RESULT_CHARS,
	ORACLE_MAX_TOTAL_CHARS,
	validateOracleRequest,
} from "./oracle-policy.ts";

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
	/** Required at runtime when mode is "oracle". The host validates this before any evidence operation. */
	oracleRoot?: string;
	/** Optional override for the evidence-request cap (1..3). Cannot exceed the hard maximum. */
	maxEvidenceRequests?: number;
}

interface PitajResultDetails {
	model: string;
	alias?: string;
	mode: PitajMode;
	brevity: PitajBrevity;
	question: string;
	contextChars: number;
	answerChars: number;
	maxOutputChars: number;
	answer: string;
	durationMs: number;
	settingsPath: string;
	settingsWarning?: string;
	stopReason?: string;
	/** Answer was provider-truncated (stopReason "length") or clipped at maxOutputChars. */
	truncated?: boolean;
	autoRouted?: boolean;
	routingReason?: string;
	autoSuggestedMode?: PitajMode;
	snapshot?: PitajSnapshotDetails;
	oracle?: {
		readOnlyEvidence: true;
		requestLimit: number;
		requestsUsed: number;
		totalEvidenceChars: number;
		hostActionsAutomatic: false;
	};
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
		return withAutoRouteWarning({ settings: mergeSettings(), fileState: "not-found" });
	}

	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as unknown;
		return withAutoRouteWarning({ settings: mergeSettings(settingsFromUnknown(parsed)), fileState: "loaded" });
	} catch (error) {
		return {
			settings: mergeSettings(),
			fileState: "malformed",
			warning: `Could not read pitaj settings.json; using built-in defaults. ${errorMessage(error)}`,
		};
	}
}

/** Attach the auto-route misconfiguration warning at load time, not first-consult time. */
function withAutoRouteWarning(loaded: LoadedSettings): LoadedSettings {
	const warning = validateAutoRouteAliases(loaded.settings);
	if (!warning) return loaded;
	return { ...loaded, warning: loaded.warning ? `${loaded.warning} ${warning}` : warning };
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
		"  /pitaj auto [--risk low|high] [--mode <mode>] [--brevity <level>] [-c <context>] <question>",
		"  /pitaj advise <question>",
		"  /pitaj advise accepts only a bare question; use /pitaj snapshot for --mode/--brevity/-c/model options.",
		"  /pitaj aliases",
		"  /pitaj models",
		"  /pitaj check",
		"  /pitaj usage",
		"  /pitaj usage reset",
		"  /pitaj config",
		"  /pitaj help",
		"",
		"Options:",
		"  -m, --mode      answer | critique | debug | plan | risk-check",
		"  -b, --brevity   short | normal | detailed",
		"  -c, --context   bounded context for the sidecar model",
		"  snapshot       build a bounded session snapshot for the sidecar; no full-branch capture or tools",
		"  config         show effective settings; with UI, edit common settings after confirmation",
		"  usage          show current-session consult counts and budget status",
		"  usage reset    clear current-session consult counters",
		"  auto and advise are reserved subcommand names and cannot be used as alias keys.",
		"  Advisory thresholds: 3 low-risk, 3 high-risk, 5 snapshot consults per session before a warning appears",
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

function getTextContent(message: AssistantMessage): string {
	return message.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}

/** Exported for behavior tests; `streamImpl` is a DI seam for a fake stream. */
export async function consultModel(
	request: PitajRequest,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	loaded?: LoadedSettings,
	onUpdate?: (update: { content: { type: "text"; text: string }[] }) => void,
	streamImpl: typeof stream = stream,
): Promise<{ answer: string; details: PitajResultDetails }> {
	const resolvedLoaded = loaded ?? loadSettings();
	const settings = resolvedLoaded.settings;
	const question = request.question.trim();
	if (!question) throw new Error("pitaj needs a question.");

	const autoRoute = request.model?.trim().toLowerCase() === "auto"
		? resolveAutoRoute({ risk: request.risk, mode: request.mode }, settings)
		: undefined;
	const mode = request.mode ?? autoRoute?.suggestedMode ?? settings.defaultMode;
	const oracleValidation = validateOracleRequest({ mode, oracleRoot: request.oracleRoot });
	if (!oracleValidation.ok) throw new Error(oracleValidation.reason);
	const oracleRoot = mode === "oracle" ? await approveOracleRoot(request.oracleRoot ?? "") : undefined;
	const maxEvidenceRequests = clampEvidenceRequestOverride(request.maxEvidenceRequests);

	const resolved = resolveModelRef(autoRoute?.alias ?? request.model, settings);
	const model = ctx.modelRegistry.find(resolved.provider, resolved.modelId);
	if (!model) {
		throw new Error(
			`pitaj model is not registered: ${resolved.resolved}. Check ${SETTINGS_PATH} or run /model to confirm the provider/model id.`,
		);
	}
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${resolved.resolved}` : auth.error);

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
	const messages: Message[] = [userMessage];
	let evidenceBudget = createOracleBudgetState();
	let response: AssistantMessage | undefined;
	let terminalText = "";
	let streamError: unknown;

	while (true) {
		const streamResponse = streamImpl(
			model,
			mode === "oracle"
				? {
					systemPrompt: buildConsultSystemPrompt(mode, brevity, maxEvidenceRequests),
					messages,
					tools: [PITAJ_EVIDENCE_TOOL],
				}
				: {
					systemPrompt: buildConsultSystemPrompt(mode, brevity),
					messages,
				},
			{ apiKey: auth.apiKey, headers: auth.headers, signal },
		);
		let roundText = "";
		try {
			for await (const event of streamResponse) {
				if (event.type === "text_delta") {
					roundText += event.delta;
					onUpdate?.({ content: [{ type: "text", text: roundText }] });
				}
			}
		} catch (error) {
			streamError = error;
		}
		response = await streamResponse.result();
		terminalText = roundText;
		if (mode !== "oracle" || response.stopReason !== "toolUse") break;

		const toolCalls = response.content.filter(
			(part): part is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => part.type === "toolCall",
		);
		if (toolCalls.length === 0) throw new Error("Oracle model requested evidence without a tool call.");
		messages.push(response);
		let exhausted = false;
		for (const toolCall of toolCalls) {
			const check = checkEvidenceBudget(evidenceBudget, maxEvidenceRequests);
			let result: { content: string; isError: boolean };
			if (!check.allowed) {
				evidenceBudget = consumeEvidenceBudget(evidenceBudget, 0);
				result = { content: `Evidence request refused: ${check.reason}`, isError: true };
				exhausted = true;
			} else if (toolCall.name !== PITAJ_EVIDENCE_TOOL_NAME) {
				evidenceBudget = consumeEvidenceBudget(evidenceBudget, 0);
				result = { content: "Evidence request refused: unsupported tool name", isError: true };
			} else {
				const remainingChars = Math.min(
					ORACLE_MAX_RESULT_CHARS,
					ORACLE_MAX_TOTAL_CHARS - evidenceBudget.totalChars,
				);
				if (!oracleRoot) throw new Error("Oracle mode is missing its approved repository root.");
				result = await executeOracleEvidence(oracleRoot, toolCall.arguments as unknown, remainingChars);
				evidenceBudget = consumeEvidenceBudget(evidenceBudget, result.isError ? 0 : result.content.length);
			}
			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: result.content }],
				isError: result.isError,
				timestamp: Date.now(),
			};
			messages.push(toolResult);
		}
		if (exhausted) throw new Error("Oracle evidence request limit reached; no further evidence requests are allowed.");
	}

	if (!response) throw new Error("pitaj did not produce a response.");
	const rawAnswer = getTextContent(response);
	const { answer, truncated } = finalizeConsultAnswer(
		{
			...(response.stopReason ? { stopReason: response.stopReason } : {}),
			...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
			rawText: rawAnswer,
			partialChars: terminalText.length,
			...(streamError instanceof Error ? { streamErrorMessage: streamError.message } : {}),
		},
		maxOutputChars,
	);

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
			maxOutputChars,
			answer,
			...(mode === "oracle"
				? {
					oracle: {
						readOnlyEvidence: true as const,
						requestLimit: maxEvidenceRequests,
						requestsUsed: evidenceBudget.requestsUsed,
						totalEvidenceChars: evidenceBudget.totalChars,
						hostActionsAutomatic: false as const,
					},
				}
				: {}),
			durationMs: Date.now() - startedAt,
			settingsPath: SETTINGS_PATH,
			...(resolvedLoaded.warning ? { settingsWarning: resolvedLoaded.warning } : {}),
			...(response.stopReason ? { stopReason: response.stopReason } : {}),
			...(truncated ? { truncated: true } : {}),
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
				"Model alias (opus, gpt, deepseek, glm), explicit provider/model, or 'auto' for built-in routing.",
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
	oracleRoot: Type.Optional(
		Type.String({
			description:
				"Required when mode is 'oracle'. An explicitly approved repository root for bounded read-only evidence. There is no cwd fallback.",
		}),
	),
	maxEvidenceRequests: Type.Optional(
		Type.Number({
			description: "Override the evidence-request cap for oracle mode (1..3). Cannot exceed the hard maximum of 3.",
			minimum: 1,
			maximum: 3,
		}),
	),
});

function buildErrorDetails(params: PitajRequest, loaded: LoadedSettings): PitajResultDetails {
	return {
		model: params.model ?? "unknown",
		alias: undefined,
		mode: params.mode ?? "answer",
		brevity: params.brevity ?? "normal",
		question: params.question,
		contextChars: params.context?.length ?? 0,
		answerChars: 0,
		maxOutputChars: resolveMaxOutputChars(params.maxOutputChars, loaded.settings, params.brevity ?? loaded.settings.defaultBrevity),
		answer: "",
		durationMs: 0,
		settingsPath: SETTINGS_PATH,
		settingsWarning: loaded.warning,
		autoRouted: false,
		autoSuggestedMode: undefined,
	};
}

export default function pitaj(pi: ExtensionAPI): void {
	const snapshotToolResults = new SnapshotToolResultBuffer();
	registerSnapshotToolResultCapture(pi, snapshotToolResults);
	const usageRecorder = createUsageRecorder();
	function recordUsageFromDetails(
		params: PitajRequest,
		details: PitajResultDetails,
		outcome: { success: boolean },
	): void {
		usageRecorder.recordFromRequest({
			requestedModel: params.model,
			resolvedModel: details.model,
			...(details.alias ? { resolvedAlias: details.alias } : {}),
			mode: details.mode,
			brevity: details.brevity,
			...(params.risk ? { risk: params.risk } : {}),
			autoRouted: details.autoRouted === true,
			contextChars: details.contextChars,
			hasSnapshot: details.snapshot !== undefined,
			maxOutputChars: details.maxOutputChars,
			success: outcome.success,
			// "truncated" tracks answer integrity (provider length-stop or local
			// clip), not snapshot-context truncation — that lives in details.snapshot.
			truncated: details.truncated === true,
		});
	}
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
			"In ordinary modes, pitaj is a tool-less sidecar and cannot inspect files unless you provide context; explicit mode:'oracle' enables only bounded read-only evidence with a required approved oracleRoot, and host actions remain manual.",
		],
		parameters: PitajParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const contentUpdate = onUpdate
				? (update: { content: { type: "text"; text: string }[] }) => onUpdate({ ...update, details: undefined })
				: undefined;
			contentUpdate?.({ content: [{ type: "text", text: "pitaj is asking..." }] });
			const loaded = loadSettings();
			try {
				const result = await consultModel(params, ctx, signal, loaded, contentUpdate);
				recordUsageFromDetails(params, result.details, { success: true });
				const { totals } = usageRecorder.snapshot();
				const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
				return {
					content: [{ type: "text", text: formatResultForDisplay(result.answer, result.details, { warnings }) }],
					details: result.details,
				};
			} catch (error) {
				const message = errorMessage(error);
				recordUsageFromDetails(params, buildErrorDetails(params, loaded), { success: false });
				ctx.ui.notify(`pitaj failed: ${message}`, "error");
				throw error instanceof Error ? error : new Error(message);
			}
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

			if (specialCommand === "usage") {
				const normalizedUsage = trimmed.toLowerCase();
				if (normalizedUsage === "usage reset") {
					usageRecorder.reset();
					ctx.ui.notify("pitaj usage counters reset", "info");
					return;
				}
				ctx.ui.notify(usageRecorder.renderSummary(), "info");
				return;
			}

			if (specialCommand === "auto") {
				const autoArgs = trimmed.substring("auto".length).trim();

				// Extract --risk flag BEFORE parsing (parseCommandArgs doesn't recognize it)
				let risk: PitajAutoRisk | undefined;
				const riskMatch = autoArgs.match(/--risk\s+(\S+)/i);
				if (riskMatch) {
					const rawRisk = riskMatch[1].toLowerCase();
					if (rawRisk !== "low" && rawRisk !== "high") {
						ctx.ui.notify("pitaj auto: --risk must be 'low' or 'high'", "error");
						return;
					}
					risk = rawRisk as PitajAutoRisk;
				}

				// Strip --risk from args so it doesn't leak into the question or clobber -c context
				const cleanedArgs = autoArgs.replace(/--risk\s+\S+/i, "").trim();
				const parsed = parseCommandArgs(cleanedArgs, loaded.settings);

				let question = parsed.question;
				if (!question && ctx.hasUI) {
					const edited = await ctx.ui.editor("Question for pitaj auto", "");
					if (edited === undefined) {
						ctx.ui.notify("pitaj auto cancelled", "info");
						return;
					}
					question = edited.trim();
				}
				if (!question) {
					ctx.ui.notify(usageText(), "info");
					return;
				}

				const autoRequest = {
					model: "auto" as const,
					question,
					mode: parsed.mode,
					brevity: parsed.brevity,
					context: parsed.context,
					risk,
				};

				ctx.ui.setStatus("pitaj auto", "auto-routing...");
				try {
					const result = await consultModel(autoRequest, ctx, undefined, loaded);
					recordUsageFromDetails(autoRequest, result.details, { success: true });
					const { totals } = usageRecorder.snapshot();
					const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
					const display = formatResultForDisplay(result.answer, result.details, { warnings });
					pi.sendMessage({
						customType: "pitaj",
						content: display,
						display: true,
						details: result.details
					});
					ctx.ui.notify(`pitaj auto answered with ${result.details.model}`, "info");
				} catch (error) {
					const message = errorMessage(error);
					recordUsageFromDetails(autoRequest, buildErrorDetails(autoRequest, loaded), { success: false });
					ctx.ui.notify(`pitaj auto failed: ${message}`, "error");
				} finally {
					ctx.ui.setStatus("pitaj auto", undefined);
				}
				return;
			}

			if (specialCommand === "advise") {
				const adviseInput = trimmed.substring("advise".length).trim();

				// ZERO-FLAG REJECTION
				const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation(adviseInput, loaded.settings);
				if (forbiddenFlags.length > 0 || looksLikeModel) {
					ctx.ui.notify(
						"pitaj advise accepts only a bare question — no --mode, --brevity, -c, or model arguments. Use /pitaj snapshot for full options.",
						"warning",
					);
					return;
				}

				// Editor fallback for empty question
				let question = adviseInput;
				if (!question && ctx.hasUI) {
					const edited = await ctx.ui.editor("Question for pitaj advise", "");
					if (edited === undefined) {
						ctx.ui.notify("pitaj advise cancelled", "info");
						return;
					}
					question = edited.trim();
				}
				if (!question) {
					ctx.ui.notify(usageText(), "info");
					return;
				}

				// Build snapshot context via existing path
				const snapshotRequest = buildSnapshotCommandRequest(
					{
						question,
						model: undefined,
						mode: undefined,
						brevity: undefined,
						context: undefined,
					},
					loaded.settings,
					{ sessionManager: ctx.sessionManager, toolResults: snapshotToolResults },
				);

				ctx.ui.setStatus("pitaj advise", "asking...");
				try {
					const result = await consultModel(snapshotRequest.request, ctx, undefined, loaded);
					const details = { ...result.details, snapshot: snapshotRequest.snapshot };
					recordUsageFromDetails(snapshotRequest.request, details, { success: true });
					const { totals } = usageRecorder.snapshot();
					const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));

					const advisoryContent = formatResultForDisplay(result.answer, details, { warnings, isAdvisory: true });

					pi.sendMessage({
						customType: "pitaj",
						content: advisoryContent,
						display: true,
						details,
					});
					ctx.ui.notify(`pitaj advise answered with ${result.details.model}`, "info");
				} catch (error) {
					const message = errorMessage(error);
					recordUsageFromDetails(
						snapshotRequest.request,
						{
							...buildErrorDetails(snapshotRequest.request, loaded),
							snapshot: snapshotRequest.snapshot,
						},
						{ success: false },
					);
					ctx.ui.notify(`pitaj advise failed: ${message}`, "error");
				} finally {
					ctx.ui.setStatus("pitaj advise", undefined);
				}
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
					recordUsageFromDetails(snapshotRequest.request, details, { success: true });
				const { totals } = usageRecorder.snapshot();
				const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
					pi.sendMessage({
						customType: "pitaj",
						content: formatResultForDisplay(result.answer, details, { warnings }),
						display: true,
						details,
					});
					ctx.ui.notify(`pitaj snapshot answered with ${result.details.model}`, "info");
				} catch (error) {
					const message = errorMessage(error);
					recordUsageFromDetails(snapshotRequest.request, { ...buildErrorDetails(snapshotRequest.request, loaded), snapshot: snapshotRequest.snapshot }, { success: false });
					ctx.ui.notify(`pitaj snapshot failed: ${message}`, "error");
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

			const request: PitajRequest = {
				model: parsed.model,
				question,
				mode: parsed.mode,
				brevity: parsed.brevity,
				context: parsed.context,
			};

			ctx.ui.setStatus("pitaj", "asking...");
			try {
				const result = await consultModel(request, ctx, undefined, loaded);
				recordUsageFromDetails(request, result.details, { success: true });
				const { totals } = usageRecorder.snapshot();
				const warnings = buildInlineWarnings(applyUsageWarningFlags(totals));
				pi.sendMessage({
					customType: "pitaj",
					content: formatResultForDisplay(result.answer, result.details, { warnings }),
					display: true,
					details: result.details,
				});
				ctx.ui.notify(`pitaj answered with ${result.details.model}`, "info");
			} catch (error) {
				const message = errorMessage(error);
				recordUsageFromDetails(request, buildErrorDetails(request, loaded), { success: false });
				ctx.ui.notify(`pitaj failed: ${message}`, "error");
			} finally {
				ctx.ui.setStatus("pitaj", undefined);
			}
		},
	});
}

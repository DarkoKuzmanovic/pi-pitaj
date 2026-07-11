export const PITAJ_MODES = ["answer", "critique", "debug", "plan", "risk-check", "oracle"] as const;
export const PITAJ_BREVITIES = ["short", "normal", "detailed"] as const;

export type PitajMode = (typeof PITAJ_MODES)[number];
export type PitajBrevity = (typeof PITAJ_BREVITIES)[number];

export const PITAJ_AUTO_RISKS = ["low", "high"] as const;
export type PitajAutoRisk = (typeof PITAJ_AUTO_RISKS)[number];

export const DEFAULT_MAX_CONTEXT_CHARS = 12_000;
export const DEFAULT_AUTO_ROUTE_LOW = "gpt";
export const DEFAULT_AUTO_ROUTE_HIGH = "opus";

export interface PitajSettings {
	defaultModel: string;
	defaultMode: PitajMode;
	defaultBrevity: PitajBrevity;
	maxContextChars?: number;
	maxOutputChars?: number;
	autoRouteLow?: string;
	autoRouteHigh?: string;
	aliases: Record<string, string>;
}

export type PitajSettingsFileState = "not-found" | "loaded" | "malformed";
export const CONFIG_EDITABLE_FIELDS = [
	"defaultModel",
	"autoRouteLow",
	"autoRouteHigh",
	"defaultMode",
	"defaultBrevity",
	"maxContextChars",
	"maxOutputChars",
] as const;

export type ConfigEditableField = (typeof CONFIG_EDITABLE_FIELDS)[number];

export interface SettingsSummary {
	fileState: PitajSettingsFileState;
	effective: {
		defaultModel: string;
		defaultMode: PitajMode;
		defaultBrevity: PitajBrevity;
		maxContextChars?: number;
		maxOutputChars?: number;
		autoRouteLow: string;
		autoRouteHigh: string;
	};
	aliasCount: number;
	aliasSamples: string[];
	manualEditHint: string;
	manualRecoveryPath?: boolean;
}

export interface SettingsWritePlan {
	fileState: PitajSettingsFileState;
	canWrite: boolean;
	action: "create" | "overwrite" | "refuse";
	reason: string;
}

export interface ResolvedModelRef {
	input: string;
	provider: string;
	modelId: string;
	resolved: string;
	alias?: string;
}

export interface ParsedCommandArgs {
	model?: string;
	question: string;
	mode?: PitajMode;
	brevity?: PitajBrevity;
	context?: string;
}

export interface AutoRouteInput {
	risk?: PitajAutoRisk;
	mode?: PitajMode;
}

export interface AutoRouteResult {
	alias: string;
	routingReason: string;
	suggestedMode?: PitajMode;
}

export const DEFAULT_SETTINGS: PitajSettings = {
	defaultModel: "opus",
	defaultMode: "answer",
	defaultBrevity: "short",
	autoRouteLow: DEFAULT_AUTO_ROUTE_LOW,
	autoRouteHigh: DEFAULT_AUTO_ROUTE_HIGH,
	aliases: {
		opus: "anthropic/claude-opus-4-8",
		opus47: "anthropic/claude-opus-4-7",
		deepseek: "deepseek/deepseek-v4-pro",
		glm: "zai/glm-5.1",
		spark: "openai-codex/gpt-5.3-codex-spark",
		mm: "minimax/MiniMax-M2.7-highspeed",
		gpt: "openai-codex/gpt-5.5",
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPitajMode(value: unknown): value is PitajMode {
	return typeof value === "string" && PITAJ_MODES.includes(value as PitajMode);
}

function isPitajAutoRisk(value: unknown): value is PitajAutoRisk {
	return typeof value === "string" && PITAJ_AUTO_RISKS.includes(value as PitajAutoRisk);
}

function isPitajBrevity(value: unknown): value is PitajBrevity {
	return typeof value === "string" && PITAJ_BREVITIES.includes(value as PitajBrevity);
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function trimmedNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeAliases(aliases: unknown): Record<string, string> {
	if (!isRecord(aliases)) return {};
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(aliases)) {
		const alias = key.trim().toLowerCase();
		if (!alias || typeof value !== "string") continue;
		const target = value.trim();
		if (target) normalized[alias] = target;
	}
	return normalized;
}

export function settingsFromUnknown(value: unknown): Partial<PitajSettings> {
	if (!isRecord(value)) return {};
	return {
		defaultModel: trimmedNonEmptyString(value.defaultModel),
		defaultMode: isPitajMode(value.defaultMode) ? value.defaultMode : undefined,
		defaultBrevity: isPitajBrevity(value.defaultBrevity) ? value.defaultBrevity : undefined,
		maxContextChars: positiveInteger(value.maxContextChars),
		maxOutputChars: positiveInteger(value.maxOutputChars),
		autoRouteLow: trimmedNonEmptyString(value.autoRouteLow)?.toLowerCase(),
		autoRouteHigh: trimmedNonEmptyString(value.autoRouteHigh)?.toLowerCase(),
		aliases: normalizeAliases(value.aliases),
	};
}

export function mergeSettings(overrides: Partial<PitajSettings> = {}): PitajSettings {
	return {
		defaultModel: overrides.defaultModel?.trim() || DEFAULT_SETTINGS.defaultModel,
		defaultMode: overrides.defaultMode ?? DEFAULT_SETTINGS.defaultMode,
		defaultBrevity: overrides.defaultBrevity ?? DEFAULT_SETTINGS.defaultBrevity,
		...(overrides.maxContextChars !== undefined ? { maxContextChars: overrides.maxContextChars } : {}),
		...(overrides.maxOutputChars !== undefined ? { maxOutputChars: overrides.maxOutputChars } : {}),
		...(overrides.autoRouteLow !== undefined ? { autoRouteLow: overrides.autoRouteLow.toLowerCase() } : {}),
		...(overrides.autoRouteHigh !== undefined ? { autoRouteHigh: overrides.autoRouteHigh.toLowerCase() } : {}),
		aliases: {
			...DEFAULT_SETTINGS.aliases,
			...(overrides.aliases ?? {}),
		},
	};
}

/**
 * Config-load-time check that the auto-route aliases point at configured
 * aliases. Returns a warning string rather than throwing: the consult path
 * still fails loudly at use time, but the user should learn at load time,
 * not on the first `/pitaj auto` call.
 */
export function validateAutoRouteAliases(settings: PitajSettings): string | undefined {
	const problems: string[] = [];
	const routes = [
		["autoRouteLow", settings.autoRouteLow ?? DEFAULT_AUTO_ROUTE_LOW],
		["autoRouteHigh", settings.autoRouteHigh ?? DEFAULT_AUTO_ROUTE_HIGH],
	] as const;
	for (const [field, alias] of routes) {
		if (!settings.aliases[alias]?.trim()) {
			problems.push(`${field} points at alias "${alias}" which is not defined in aliases`);
		}
	}
	if (problems.length === 0) return undefined;
	return `pitaj auto-routing misconfigured: ${problems.join("; ")}. /pitaj auto will fail until settings.json is fixed.`;
}

function parseProviderModel(ref: string): { provider: string; modelId: string } | undefined {
	const slashIndex = ref.indexOf("/");
	if (slashIndex <= 0 || slashIndex === ref.length - 1) return undefined;
	return {
		provider: ref.slice(0, slashIndex).trim(),
		modelId: ref.slice(slashIndex + 1).trim(),
	};
}

export function resolveModelRef(input: string | undefined, settings: PitajSettings): ResolvedModelRef {
	const requested = (input?.trim() || settings.defaultModel.trim()).trim();
	if (!requested) {
		throw new Error("No pitaj model was provided and defaultModel is empty.");
	}

	const aliasKey = requested.toLowerCase();
	const aliased = settings.aliases[aliasKey];
	const target = (aliased ?? requested).trim();
	const parsed = parseProviderModel(target);
	if (!parsed) {
		const aliases = Object.keys(settings.aliases).sort().join(", ") || "none";
		throw new Error(
			`Unknown pitaj model "${requested}". Use provider/model or one of these aliases: ${aliases}`,
		);
	}

	return {
		input: requested,
		provider: parsed.provider,
		modelId: parsed.modelId,
		resolved: `${parsed.provider}/${parsed.modelId}`,
		...(aliased ? { alias: aliasKey } : {}),
	};
}

export function resolveAutoRoute(input: AutoRouteInput, settings: PitajSettings): AutoRouteResult {
	let alias: string;
	let routeLabel: string;
	let suggestedMode: PitajMode | undefined;
	const risk = input.risk as unknown;
	if (risk !== undefined && !isPitajAutoRisk(risk)) {
		throw new Error(`Unknown pitaj auto risk "${String(risk)}". Use low or high.`);
	}

	const lowAlias = settings.autoRouteLow ?? DEFAULT_AUTO_ROUTE_LOW;
	const highAlias = settings.autoRouteHigh ?? DEFAULT_AUTO_ROUTE_HIGH;
	if (risk === "high") {
		alias = highAlias;
		routeLabel = "risk=high";
		if (input.mode === undefined) {
			suggestedMode = "risk-check";
		}
	} else if (risk === "low") {
		alias = lowAlias;
		routeLabel = "risk=low";
	} else if (input.mode === "risk-check") {
		alias = highAlias;
		routeLabel = "mode=risk-check";
	} else {
		alias = lowAlias;
		routeLabel = "default";
	}

	const target = settings.aliases[alias];
	if (!target?.trim()) {
		throw new Error(`pitaj auto routing requires a non-empty "${alias}" alias in settings.json`);
	}

	return {
		alias,
		routingReason: `auto: ${routeLabel} → ${alias}`,
		...(suggestedMode !== undefined ? { suggestedMode } : {}),
	};
}

export type SpecialCommand = "help" | "aliases" | "models" | "check" | "snapshot" | "config" | "usage" | "auto" | "advise" | "none";

export function classifySpecialCommand(input: string): SpecialCommand {
	const normalized = input.trim().toLowerCase();
	if (normalized === "config" || normalized.startsWith("config ")) {
		return "config";
	}
	if (normalized === "auto" || normalized.startsWith("auto ")) {
		return "auto";
	}
	if (normalized === "advise" || normalized.startsWith("advise ")) {
		return "advise";
	}
	switch (normalized) {
		case "help":
		case "-h":
		case "--help":
			return "help";
		case "aliases":
		case "models":
			return normalized as "aliases" | "models";
		case "usage":
		case "usage reset":
			return "usage";
		case "check":
			return "check";
		case "snapshot":
			return "snapshot";
		case "config":
			return "config";
		default:
			return "none";
	}
}

export type AdviseFlagViolation = { forbiddenFlags: string[]; looksLikeModel: boolean };

export function isAdviseFlagViolation(
	adviseInput: string,
	settings: PitajSettings,
): AdviseFlagViolation {
	const tokens = adviseInput.split(/\s+/);
	const firstToken = tokens[0]?.toLowerCase();
	const forbiddenFlags = ["--mode", "-m", "--brevity", "-b", "--context", "-c"];
	// Match both spaced (`--mode plan`) and inline (`--mode=plan`) forms.
	const hasForbiddenFlags = forbiddenFlags.filter((f) => tokens.some((t) => t === f || t.startsWith(`${f}=`)));
	const looksLikeModel =
		firstToken && (firstToken.includes("/") || settings.aliases[firstToken]);
	return {
		forbiddenFlags: hasForbiddenFlags,
		looksLikeModel: Boolean(looksLikeModel),
	};
}

export const BREVITY_OUTPUT_CHARS: Record<PitajBrevity, number> = {
	short: 2_000,
	normal: 4_000,
	detailed: 8_000,
};

export function resolveMaxOutputChars(
	requestMaxOutputChars: number | undefined,
	settings: PitajSettings,
	brevity: PitajBrevity,
): number {
	return requestMaxOutputChars ?? settings.maxOutputChars ?? BREVITY_OUTPUT_CHARS[brevity];
};

export function parseCommandArgs(args: string, settings: PitajSettings): ParsedCommandArgs {
	const trimmed = args.trim();
	if (!trimmed) return { question: "" };

	// Pre-process: merge quoted tokens into single tokens
	const tokens = tokenizeWithQuotes(trimmed);
	let i = 0;

	// Check if the first token is a known alias or provider/model
	let model: string | undefined;
	if (tokens[0] && (settings.aliases[tokens[0].toLowerCase()] || tokens[0].includes("/"))) {
		model = tokens[0];
		i = 1;
	}

	let mode: PitajMode | undefined;
	let brevity: PitajBrevity | undefined;
	let context: string | undefined;
	const questionParts: string[] = [];

	while (i < tokens.length) {
		const token = tokens[i];
		if ((token === "--mode" || token === "-m") && i + 1 < tokens.length) {
			const val = tokens[++i];
			if (PITAJ_MODES.includes(val as PitajMode)) mode = val as PitajMode;
			else questionParts.push(token, val);
		} else if ((token === "--brevity" || token === "-b") && i + 1 < tokens.length) {
			const val = tokens[++i];
			if (PITAJ_BREVITIES.includes(val as PitajBrevity)) brevity = val as PitajBrevity;
			else questionParts.push(token, val);
		} else if ((token === "--context" || token === "-c") && i + 1 < tokens.length) {
			context = tokens[++i];
		} else {
			questionParts.push(token);
		}
		i++;
	}

	return { model, question: questionParts.join(" ").trim(), mode, brevity, context };
}

/** Split on whitespace, but merge double-quoted segments into single tokens (quotes stripped). */
function tokenizeWithQuotes(input: string): string[] {
	// An unbalanced quote would silently corrupt every token after the stray
	// character; fall back to plain whitespace splitting instead.
	const quoteCount = (input.match(/"/g) ?? []).length;
	if (quoteCount % 2 !== 0) {
		return input.split(/\s+/).filter(Boolean);
	}
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === '"') {
			inQuotes = !inQuotes;
			continue; // strip quote character
		}
		if (ch === " " && !inQuotes) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}

	if (current) tokens.push(current);
	return tokens;
}

export function summarizeSettings(settings: PitajSettings, fileState: PitajSettingsFileState): SettingsSummary {
	const aliasEntries = Object.entries(settings.aliases).sort(([a], [b]) => a.localeCompare(b));
	return {
		fileState,
		effective: {
			defaultModel: settings.defaultModel,
			defaultMode: settings.defaultMode,
			defaultBrevity: settings.defaultBrevity,
			maxContextChars: settings.maxContextChars,
			maxOutputChars: settings.maxOutputChars,
			autoRouteLow: settings.autoRouteLow ?? DEFAULT_AUTO_ROUTE_LOW,
			autoRouteHigh: settings.autoRouteHigh ?? DEFAULT_AUTO_ROUTE_HIGH,
		},
		aliasCount: aliasEntries.length,
		aliasSamples: aliasEntries.slice(0, 5).map(([alias, target]) => `${alias} -> ${target}`),
		manualEditHint: "Edit settings.json manually for advanced alias changes.",
		...(fileState === "malformed" ? { manualRecoveryPath: true } : {}),
	};
}

export function formatConfigSummaryText(summary: SettingsSummary, settingsPath: string): string {
	const effective = summary.effective;
	const lines = [
		`pitaj config (${settingsPath})`,
		`fileState: ${summary.fileState}`,
		`defaultModel: ${effective.defaultModel}`,
		`defaultMode: ${effective.defaultMode}`,
		`defaultBrevity: ${effective.defaultBrevity}`,
		`maxContextChars: ${effective.maxContextChars ?? "default"}`,
		`maxOutputChars: ${effective.maxOutputChars ?? "brevity default"}`,
		`autoRouteLow: ${effective.autoRouteLow}`,
		`autoRouteHigh: ${effective.autoRouteHigh}`,
		`aliases: ${summary.aliasCount}`,
	];
	if (summary.aliasSamples.length > 0) {
		lines.push("alias samples:", ...summary.aliasSamples.map((item) => `  ${item}`));
	}
	if (summary.manualRecoveryPath) {
		lines.push("settings.json is malformed; pitaj is using defaults and will not overwrite it automatically.");
	}
	lines.push(summary.manualEditHint);
	return lines.join("\n");
}

export function serializeSettings(settings: PitajSettings): string {
	const serialized: Record<string, unknown> = {
		defaultModel: settings.defaultModel,
		defaultMode: settings.defaultMode,
		defaultBrevity: settings.defaultBrevity,
	};
	if (settings.maxContextChars !== undefined) serialized.maxContextChars = settings.maxContextChars;
	if (settings.maxOutputChars !== undefined) serialized.maxOutputChars = settings.maxOutputChars;
	if (settings.autoRouteLow !== undefined) serialized.autoRouteLow = settings.autoRouteLow;
	if (settings.autoRouteHigh !== undefined) serialized.autoRouteHigh = settings.autoRouteHigh;
	serialized.aliases = Object.fromEntries(Object.entries(settings.aliases).sort(([a], [b]) => a.localeCompare(b)));
	return `${JSON.stringify(serialized, null, 2)}\n`;
}

export function planSettingsWrite(_settings: PitajSettings, fileState: PitajSettingsFileState): SettingsWritePlan {
	if (fileState === "malformed") {
		return {
			fileState,
			canWrite: false,
			action: "refuse",
			reason: "settings.json is malformed; refusing to overwrite it without an explicit recovery flow",
		};
	}
	if (fileState === "not-found") {
		return {
			fileState,
			canWrite: true,
			action: "create",
			reason: "settings.json does not exist and can be created after validation and confirmation",
		};
	}
	return {
		fileState,
		canWrite: true,
		action: "overwrite",
		reason: "settings.json parsed cleanly and can be overwritten after validation and confirmation",
	};
}

function parseOptionalPositiveInteger(raw: string, field: ConfigEditableField): number | undefined {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.toLowerCase() === "default" || trimmed.toLowerCase() === "clear") {
		return undefined;
	}
	const parsed = Number(trimmed);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${field} must be a positive integer, blank, default, or clear.`);
	}
	return parsed;
}

function requireAlias(settings: PitajSettings, raw: string, field: ConfigEditableField): string {
	const alias = raw.trim().toLowerCase();
	if (!alias || !settings.aliases[alias]) {
		throw new Error(`${field} must name an existing alias in settings.json.`);
	}
	return alias;
}

export function applyConfigUpdate(settings: PitajSettings, field: ConfigEditableField, rawValue: string): PitajSettings {
	const value = rawValue.trim();
	switch (field) {
		case "defaultModel":
			if (!value) throw new Error("defaultModel must be a non-empty alias or provider/model.");
			resolveModelRef(value, settings);
			return { ...settings, defaultModel: value };
		case "autoRouteLow":
			return { ...settings, autoRouteLow: requireAlias(settings, value, field) };
		case "autoRouteHigh":
			return { ...settings, autoRouteHigh: requireAlias(settings, value, field) };
		case "defaultMode":
			if (!isPitajMode(value)) throw new Error(`defaultMode must be one of: ${PITAJ_MODES.join(", ")}.`);
			return { ...settings, defaultMode: value };
		case "defaultBrevity":
			if (!isPitajBrevity(value)) throw new Error(`defaultBrevity must be one of: ${PITAJ_BREVITIES.join(", ")}.`);
			return { ...settings, defaultBrevity: value };
		case "maxContextChars":
			return { ...settings, maxContextChars: parseOptionalPositiveInteger(rawValue, field) };
		case "maxOutputChars":
			return { ...settings, maxOutputChars: parseOptionalPositiveInteger(rawValue, field) };
	}
}

function settingDisplayValue(value: string | number | undefined): string {
	return value === undefined ? "default" : String(value);
}

export function formatSettingsChangeSummary(before: PitajSettings, after: PitajSettings): string {
	const lines: string[] = [];
	for (const field of CONFIG_EDITABLE_FIELDS) {
		if (before[field] !== after[field]) {
			lines.push(`${field}: ${settingDisplayValue(before[field])} -> ${settingDisplayValue(after[field])}`);
		}
	}
	return lines.length > 0 ? lines.join("\n") : "No settings changes.";
}

export function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = text.slice(0, Math.max(0, maxChars));
	const omitted = text.length - head.length;
	return `${head}\n\n[pitaj truncated ${omitted} characters]`;
}

/** Stream outcome facts `consultModel` extracts from the pi-ai response. */
export interface ConsultStreamOutcome {
	stopReason?: string;
	errorMessage?: string;
	/** Full text content extracted from the final response message. */
	rawText: string;
	/** Chars accumulated from text deltas before the stream ended/failed. */
	partialChars: number;
	/** Message of the error thrown by the stream iterator, if any. */
	streamErrorMessage?: string;
}

/**
 * Turn a finished consult stream into a final answer — or a loud failure.
 * A consult that died mid-stream must never be returned as a normal answer:
 * a half-finished risk-check reads as a complete one.
 *
 * - `aborted` / `error` → throw (with provider error and partial-size facts)
 * - `length` → answer returned but visibly marked as provider-truncated
 * - local `maxOutputChars` clipping also flips `truncated`
 */
export function finalizeConsultAnswer(
	outcome: ConsultStreamOutcome,
	maxOutputChars: number,
): { answer: string; truncated: boolean } {
	if (outcome.stopReason === "aborted") {
		throw new Error("pitaj consult was aborted.");
	}
	if (outcome.stopReason === "error") {
		const detail = outcome.errorMessage?.trim() || outcome.streamErrorMessage?.trim() || "unknown provider error";
		throw new Error(
			`pitaj consult failed mid-stream: ${detail} (received ${outcome.partialChars} chars of partial text before failure)`,
		);
	}
	const trimmed = outcome.rawText.trim();
	const locallyTruncated = trimmed.length > maxOutputChars;
	let answer = truncateText(trimmed || "(pitaj returned no text)", maxOutputChars);
	const providerTruncated = outcome.stopReason === "length";
	if (providerTruncated) {
		answer = `${answer}\n\n⚠ [pitaj: provider stopped at max output tokens — answer may be incomplete]`;
	}
	return { answer, truncated: providerTruncated || locallyTruncated };
}

export function buildConsultSystemPrompt(mode: PitajMode, brevity: PitajBrevity): string {
	const modeInstruction: Record<PitajMode, string> = {
		answer: "Answer the question directly. Surface uncertainty instead of over-explaining.",
		critique: "Critique the proposal. Look for flaws, missed edge cases, and hidden assumptions.",
		debug: "Debug from evidence. Name likely causes, discriminating checks, and the next smallest test.",
		plan: "Produce a practical plan with ordered steps, tradeoffs, and validation points.",
		"risk-check": "List concrete risks, failure modes, and mitigations. Prioritize by likelihood and impact.",
		oracle: "Investigate using bounded evidence, then answer. Request only what you need.",
	};

	const brevityInstruction: Record<PitajBrevity, string> = {
		short: "Keep it short: usually 3-8 bullets or one compact paragraph.",
		normal: "Use moderate detail, but avoid background the caller did not ask for.",
		detailed: "Be detailed where it materially improves the decision; still avoid filler.",
	};

	if (mode === "oracle") {
		return [
			"You are pitaj, a fast consultant model called inside an already-running Pi session.",
			"You are in oracle mode. You have a single bounded evidence tool: pitaj_request_evidence.",
			"Available evidence operations: read_file, search, list_files, git_diff.",
			"You may request at most 3 evidence operations. Each result is capped at 4000 characters; total evidence is capped at 12000 characters.",
			"You cannot run shell commands, write files, access the network, or select a different model.",
			"If you need an action you cannot perform, output PITAJ_NEEDS_HOST_ACTION with the requested action and reason. Do not pretend the action ran.",
			"Answer only the asked question. Do not give process narration.",
			`Mode: ${mode}. ${modeInstruction[mode]}`,
			`Brevity: ${brevity}. ${brevityInstruction[brevity]}`,
		].join("\n");
	}

	return [
		"You are pitaj, a fast consultant model called inside an already-running Pi session.",
		"You do not have tools. Do not claim you inspected files unless context was provided.",
		"Answer only the asked question. Do not give process narration.",
		`Mode: ${mode}. ${modeInstruction[mode]}`,
		`Brevity: ${brevity}. ${brevityInstruction[brevity]}`,
	].join("\n");
}

export function buildConsultUserText(question: string, context: string | undefined, maxContextChars: number): string {
	const trimmedContext = context?.trim();
	const sections: string[] = [];
	if (trimmedContext) {
		sections.push(`## Context\n\n${truncateText(trimmedContext, maxContextChars)}`);
	}
	sections.push(`## Question\n\n${question.trim()}`);
	return sections.join("\n\n");
}

// --- M3-T1 result block foundation (Batch A) --------------------------------

/**
 * Structural input for the pure result formatter. Mirrors only the fields
 * needed to render the user-visible `pitaj` consultation result block.
 *
 * Kept separate from `index.ts` `PitajResultDetails` so `helpers.ts` does not
 * import from `index.ts` and so the formatter is unit-testable without
 * registering the Pi extension.
 */
export interface PitajResultDisplaySnapshot {
	includedCategories: readonly string[];
	truncatedCategories: readonly string[];
	omittedCategories: readonly string[];
	truncated: boolean;
}

export interface PitajResultDisplayDetails {
	model: string;
	alias?: string;
	mode: string;
	brevity: string;
	contextChars: number;
	question?: string;
	settingsPath?: string;
	settingsWarning?: string;
	stopReason?: string;
	autoRouted?: boolean;
	routingReason?: string;
	autoSuggestedMode?: string;
	snapshot?: PitajResultDisplaySnapshot;
}

export interface FormatResultOptions {
	/**
	 * Optional post-answer extension slot. Rendered as compact bullet lines
	 * after the metadata footer. Designed for M3-T5 budget warnings to plug
	 * into without reopening T1 core formatting tests.
	 */
	warnings?: readonly string[];
	/**
	 * When true, renders an "advisory" label in the footer snapshot metadata.
	 */
	isAdvisory?: boolean;
}

export function formatResultForDisplay(
	answer: string,
	details: PitajResultDisplayDetails,
	options: FormatResultOptions = {},
): string {
	const sections: string[] = [];

	const displayModel = details.model?.trim() || "unknown";
	const displayAlias = details.alias?.trim();
	const modelLabel = `${displayModel}${displayAlias ? ` (${displayAlias})` : ""}`;

	const answerText = (answer ?? "").trimEnd() || "(pitaj returned no text)";
	sections.push(answerText);

	const footerLines: string[] = [`model: ${modelLabel}`];

	const routeBits: string[] = [];
	if (details.mode) routeBits.push(`mode=${details.mode}`);
	if (details.brevity) routeBits.push(`brevity=${details.brevity}`);
	if (details.autoRouted) {
		routeBits.push("auto-routed");
		if (details.routingReason) {
			routeBits.push(`reason=${details.routingReason}`);
		}
	}
	if (routeBits.length > 0) {
		footerLines.push(`route: ${routeBits.join(" · ")}`);
	}

	if (details.snapshot) {
		footerLines.push("context: snapshot");
		const included = details.snapshot.includedCategories.length;
		const truncatedCount = details.snapshot.truncatedCategories.length;
		const omitted = details.snapshot.omittedCategories.length;
		const totalChars = details.snapshot.truncated ? "truncated" : "ok";
		const categoryList = describeCategoryList([
			...details.snapshot.includedCategories.map((category) => `+${category}`),
			...details.snapshot.truncatedCategories.map((category) => `~${category}`),
			...details.snapshot.omittedCategories.map((category) => `-${category}`),
		]);
		footerLines.push(
			`snapshot: included=${included}, truncated=${truncatedCount}, omitted=${omitted}, size=${totalChars} (${categoryList})`,
		);
	} else if (details.contextChars > 0) {
		footerLines.push(`context: manual, ${details.contextChars} chars`);
	} else {
		footerLines.push("context: none");
	}

	if (options.isAdvisory) {
		footerLines.push("advisory: true — advisory snapshot consult");
	}

	const warnings = options.warnings ?? [];
	if (warnings.length > 0) {
		for (const warning of warnings) {
			if (warning?.trim()) footerLines.push(`warning: ${warning.trim()}`);
		}
	}

	if (details.snapshot) {
		footerLines.push("sidecar: no tools / no file access (snapshot context only)");
	} else if (details.contextChars > 0) {
		footerLines.push("sidecar: no tools / no file access (caller-provided context only)");
	} else {
		footerLines.push("sidecar: no tools / no file access (no context provided)");
	}

	if (footerLines.length > 0) {
		sections.push("");
		sections.push("---");
		for (const line of footerLines) sections.push(line);
	}

	return sections.join("\n");
}

function describeCategoryList(items: readonly string[]): string {
	if (items.length === 0) return "none";
	return items.join(", ");
}

// --- M3-B2 usage accounting (Batch B) ---------------------------------------

export type UsageContextSource = "none" | "manual" | "snapshot";

export type UsageRouteKind =
	| "auto-low"
	| "auto-high"
	| "auto-risk-check"
	| "explicit-low"
	| "explicit-high"
	| "explicit-other"
	| "snapshot"
	| "error";

export type UsageRisk = "low" | "high" | "none" | "unknown";

export interface UsageEvent {
	timestamp: number;
	requestedModel: string;
	resolvedModel: string;
	resolvedAlias?: string;
	autoRouted: boolean;
	routeKind: UsageRouteKind;
	mode: string;
	brevity: string;
	risk: UsageRisk;
	contextSource: UsageContextSource;
	contextChars: number;
	maxOutputChars: number;
	success: boolean;
	truncated: boolean;
}

export const USAGE_BUDGET = {
	lowRisk: 3,
	highRisk: 3,
	snapshot: 5,
} as const;

export type UsageBudgetGroup = "low-risk" | "high-risk" | "snapshot";

export interface UsageBudgetState {
	lowRisk: number;
	highRisk: number;
	snapshot: number;
	lowRiskWarned: boolean;
	highRiskWarned: boolean;
	snapshotWarned: boolean;
}

export interface UsageStoreSnapshot {
	events: readonly UsageEvent[];
	totals: UsageBudgetState;
}

export interface UsageSummary {
	total: number;
	byRouteKind: Record<UsageRouteKind, number>;
	byContext: Record<UsageContextSource, number>;
	byRisk: Record<UsageRisk, number>;
	byModel: Record<string, number>;
	errors: number;
	/** Consults whose answer was provider- or locally truncated. */
	truncated: number;
	budget: UsageBudgetState;
	warningsReached: UsageBudgetGroup[];
	budgetStatus: "ok" | "warning";
}

export function createUsageStore(): {
	record: (event: UsageEvent) => void;
	snapshot: () => UsageStoreSnapshot;
	reset: () => void;
} {
	const events: UsageEvent[] = [];
	const totals: UsageBudgetState = {
		lowRisk: 0,
		highRisk: 0,
		snapshot: 0,
		lowRiskWarned: false,
		highRiskWarned: false,
		snapshotWarned: false,
	};

	function record(event: UsageEvent): void {
		events.push(event);
		if (!event.success) return;
		if (event.contextSource === "snapshot") {
			totals.snapshot += 1;
			if (!totals.snapshotWarned && totals.snapshot >= USAGE_BUDGET.snapshot) {
				totals.snapshotWarned = true;
			}
			return;
		}
		if (event.risk === "low") {
			totals.lowRisk += 1;
			if (!totals.lowRiskWarned && totals.lowRisk >= USAGE_BUDGET.lowRisk) {
				totals.lowRiskWarned = true;
			}
		} else if (event.risk === "high") {
			totals.highRisk += 1;
			if (!totals.highRiskWarned && totals.highRisk >= USAGE_BUDGET.highRisk) {
				totals.highRiskWarned = true;
			}
		}
	}

	function snapshot(): UsageStoreSnapshot {
		return { events: [...events], totals: { ...totals } };
	}

	function reset(): void {
		events.length = 0;
		totals.lowRisk = 0;
		totals.highRisk = 0;
		totals.snapshot = 0;
		totals.lowRiskWarned = false;
		totals.highRiskWarned = false;
		totals.snapshotWarned = false;
	}

	return { record, snapshot, reset };
}

function inferUsageRiskFromModel(input: {
	requestedModel?: string;
	resolvedModel: string;
	resolvedAlias?: string;
}): UsageRisk {
	const label = [input.requestedModel, input.resolvedAlias, input.resolvedModel].filter(Boolean).join(" ").toLowerCase();
	if (label.includes("opus") || label.includes("claude-opus")) return "high";
	if (label.includes("gpt") || label.includes("openai-codex")) return "low";
	return "unknown";
}

export function classifyUsageEvent(input: {
	requestedModel?: string;
	resolvedModel: string;
	resolvedAlias?: string;
	autoRouted: boolean;
	risk?: PitajAutoRisk;
	mode?: string;
	success: boolean;
	contextSource: UsageContextSource;
}): { routeKind: UsageRouteKind; risk: UsageRisk } {
	if (!input.success) {
		return { routeKind: "error", risk: "none" };
	}
	if (input.contextSource === "snapshot") {
		return { routeKind: "snapshot", risk: "none" };
	}
	const mode = (input.mode ?? "").toLowerCase();
	const riskHint = input.risk;
	if (input.autoRouted) {
		if (mode === "risk-check") {
			return { routeKind: "auto-risk-check", risk: "high" };
		}
		if (riskHint === "high") {
			return { routeKind: "auto-high", risk: "high" };
		}
		return { routeKind: "auto-low", risk: "low" };
	}
	if (mode === "risk-check" || riskHint === "high") {
		return { routeKind: "explicit-high", risk: "high" };
	}
	if (riskHint === "low") {
		return { routeKind: "explicit-low", risk: "low" };
	}
	const inferredRisk = inferUsageRiskFromModel(input);
	if (inferredRisk === "high") return { routeKind: "explicit-high", risk: "high" };
	if (inferredRisk === "low") return { routeKind: "explicit-low", risk: "low" };
	return { routeKind: "explicit-other", risk: "unknown" };
}

export function detectContextSource(input: {
	hasSnapshot: boolean;
	contextChars: number;
}): UsageContextSource {
	if (input.hasSnapshot) return "snapshot";
	if (input.contextChars > 0) return "manual";
	return "none";
}

export function buildUsageSummary(snapshot: UsageStoreSnapshot): UsageSummary {
	const byRouteKind: Record<UsageRouteKind, number> = {
		"auto-low": 0,
		"auto-high": 0,
		"auto-risk-check": 0,
		"explicit-low": 0,
		"explicit-high": 0,
		"explicit-other": 0,
		snapshot: 0,
		error: 0,
	};
	const byContext: Record<UsageContextSource, number> = {
		none: 0,
		manual: 0,
		snapshot: 0,
	};
	const byRisk: Record<UsageRisk, number> = {
		low: 0,
		high: 0,
		none: 0,
		unknown: 0,
	};
	const byModel: Record<string, number> = {};
	let errors = 0;
	let truncated = 0;

	for (const event of snapshot.events) {
		byRouteKind[event.routeKind] += 1;
		byContext[event.contextSource] += 1;
		byRisk[event.risk] += 1;
		const modelKey = event.resolvedAlias ? `${event.resolvedAlias} (${event.resolvedModel})` : event.resolvedModel || event.requestedModel || "unknown";
		byModel[modelKey] = (byModel[modelKey] ?? 0) + 1;
		if (!event.success) errors += 1;
		if (event.truncated) truncated += 1;
	}

	const warningsReached: UsageBudgetGroup[] = [];
	const { totals } = snapshot;
	if (totals.lowRiskWarned) warningsReached.push("low-risk");
	if (totals.highRiskWarned) warningsReached.push("high-risk");
	if (totals.snapshotWarned) warningsReached.push("snapshot");

	return {
		total: snapshot.events.length,
		byRouteKind,
		byContext,
		byRisk,
		byModel,
		errors,
		truncated,
		budget: totals,
		warningsReached,
		budgetStatus: warningsReached.length > 0 ? "warning" : "ok",
	};
}

export function applyUsageWarningFlags(totals: UsageBudgetState): UsageBudgetState {
	const next: UsageBudgetState = { ...totals };
	if (!next.lowRiskWarned && next.lowRisk >= USAGE_BUDGET.lowRisk) {
		next.lowRiskWarned = true;
	}
	if (!next.highRiskWarned && next.highRisk >= USAGE_BUDGET.highRisk) {
		next.highRiskWarned = true;
	}
	if (!next.snapshotWarned && next.snapshot >= USAGE_BUDGET.snapshot) {
		next.snapshotWarned = true;
	}
	return next;
	}

/**
 * Build compact advisory warning lines for inline display in a result block.
 * Returns an empty array when no thresholds have been reached.
 */
export function buildInlineWarnings(totals: UsageBudgetState): readonly string[] {
	const warnings: string[] = [];
	if (totals.lowRiskWarned) {
		warnings.push(
			`You have sent ${totals.lowRisk} low-risk/GPT-style consult${totals.lowRisk === 1 ? "" : "s"} in this session. Run \`/pitaj usage\` for details or \`/pitaj usage reset\` to clear counters.`,
		);
	}
	if (totals.highRiskWarned) {
		warnings.push(
			`You have sent ${totals.highRisk} high-risk/Opus-style consult${totals.highRisk === 1 ? "" : "s"} in this session. Run \`/pitaj usage\` for details or \`/pitaj usage reset\` to clear counters.`,
		);
	}
	if (totals.snapshotWarned) {
		warnings.push(
			`You have sent ${totals.snapshot} snapshot consult${totals.snapshot === 1 ? "" : "s"} in this session. Snapshot consults are bounded but still context-heavy. Run \`/pitaj usage\` for details or \`/pitaj usage reset\` to clear counters.`,
		);
	}
	return warnings;
}

export function describeRouteKind(kind: UsageRouteKind): string {
	switch (kind) {
		case "auto-low":
			return "auto (low-risk)";
		case "auto-high":
			return "auto (high-risk)";
		case "auto-risk-check":
			return "auto risk-check";
		case "explicit-low":
			return "explicit (low-risk)";
		case "explicit-high":
			return "explicit (high-risk)";
		case "explicit-other":
			return "explicit (other)";
		case "snapshot":
			return "snapshot";
		case "error":
			return "error";
	}
}

export function formatUsageSummaryText(summary: UsageSummary): string {
	const lines: string[] = [];
	lines.push("pitaj usage (current session)");
	lines.push("");
	lines.push(`total consults: ${summary.total}`);
	lines.push(`errors: ${summary.errors}`);
	lines.push(`truncated answers: ${summary.truncated}`);

	const routeEntries = (Object.entries(summary.byRouteKind) as [UsageRouteKind, number][])
		.filter(([, count]) => count > 0)
		.sort(([a], [b]) => a.localeCompare(b));
	if (routeEntries.length > 0) {
		lines.push("");
		lines.push("routes:");
		for (const [kind, count] of routeEntries) {
			lines.push(`  ${describeRouteKind(kind)}: ${count}`);
		}
	}

	const modelEntries = Object.entries(summary.byModel).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b));
	if (modelEntries.length > 0) {
		lines.push("");
		lines.push("models:");
		for (const [model, count] of modelEntries) {
			lines.push(`  ${model}: ${count}`);
		}
	}

	const contextEntries = (Object.entries(summary.byContext) as [UsageContextSource, number][])
		.filter(([, count]) => count > 0)
		.sort(([a], [b]) => a.localeCompare(b));
	if (contextEntries.length > 0) {
		lines.push("");
		lines.push("context source:");
		for (const [source, count] of contextEntries) {
			lines.push(`  ${source}: ${count}`);
		}
	}

	lines.push("");
	lines.push("budget:");
	lines.push(`  low-risk/GPT-style: ${summary.budget.lowRisk} (warn at ${USAGE_BUDGET.lowRisk})`);
	lines.push(`  high-risk/Opus-style: ${summary.budget.highRisk} (warn at ${USAGE_BUDGET.highRisk})`);
	lines.push(`  snapshot: ${summary.budget.snapshot} (warn at ${USAGE_BUDGET.snapshot})`);

	lines.push("");
	lines.push(`status: ${summary.budgetStatus}`);
	if (summary.warningsReached.length > 0) {
		lines.push(`warnings reached: ${summary.warningsReached.join(", ")}`);
	}

	lines.push("");
	lines.push("reset with /pitaj usage reset; counters also reset when the Pi session ends.");

	return lines.join("\n");
}

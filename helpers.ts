export const PITAJ_MODES = ["answer", "critique", "debug", "plan", "risk-check"] as const;
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
		mimo: "mimo/mimo-v2.5-pro",
		deepseek: "deepseek/deepseek-v4-pro",
		glm: "zai/glm-5.1",
		spark: "openai-codex/codex-5.3-spark",
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

export type SpecialCommand = "help" | "aliases" | "models" | "check" | "snapshot" | "config" | "none";

export function classifySpecialCommand(input: string): SpecialCommand {
	const normalized = input.trim().toLowerCase();
	if (normalized === "config" || normalized.startsWith("config ")) {
		return "config";
	}
	switch (normalized) {
		case "help":
		case "-h":
		case "--help":
			return "help";
		case "aliases":
		case "models":
			return normalized as "aliases" | "models";
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

export function buildConsultSystemPrompt(mode: PitajMode, brevity: PitajBrevity): string {
	const modeInstruction: Record<PitajMode, string> = {
		answer: "Answer the question directly. Surface uncertainty instead of over-explaining.",
		critique: "Critique the proposal. Look for flaws, missed edge cases, and hidden assumptions.",
		debug: "Debug from evidence. Name likely causes, discriminating checks, and the next smallest test.",
		plan: "Produce a practical plan with ordered steps, tradeoffs, and validation points.",
		"risk-check": "List concrete risks, failure modes, and mitigations. Prioritize by likelihood and impact.",
	};

	const brevityInstruction: Record<PitajBrevity, string> = {
		short: "Keep it short: usually 3-8 bullets or one compact paragraph.",
		normal: "Use moderate detail, but avoid background the caller did not ask for.",
		detailed: "Be detailed where it materially improves the decision; still avoid filler.",
	};

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

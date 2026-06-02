// Usage event recorder that wraps createUsageStore with the in-memory store
// pattern. index.ts owns a single instance per extension setup.

import {
	createUsageStore,
	detectContextSource,
	classifyUsageEvent,
	buildUsageSummary,
	formatUsageSummaryText,
	type UsageEvent,
	type PitajAutoRisk,
	type UsageBudgetState,
} from "./helpers.ts";

export interface UsageRecorder {
	recordFromRequest: (input: {
		requestedModel?: string;
		resolvedModel: string;
		resolvedAlias?: string;
		mode: string;
		brevity: string;
		risk?: PitajAutoRisk;
		autoRouted: boolean;
		contextChars: number;
		hasSnapshot: boolean;
		maxOutputChars: number;
		success: boolean;
		truncated?: boolean;
	}) => void;
	renderSummary: () => string;
	reset: () => void;
	snapshot: () => { totals: UsageBudgetState };
}

export function createUsageRecorder(): UsageRecorder {
	const store = createUsageStore();

	function recordFromRequest(input: {
		requestedModel?: string;
		resolvedModel: string;
		resolvedAlias?: string;
		mode: string;
		brevity: string;
		risk?: PitajAutoRisk;
		autoRouted: boolean;
		contextChars: number;
		hasSnapshot: boolean;
		maxOutputChars: number;
		success: boolean;
		truncated?: boolean;
	}): void {
		const contextSource = detectContextSource({
			hasSnapshot: input.hasSnapshot,
			contextChars: input.contextChars,
		});
		const { routeKind, risk } = classifyUsageEvent({
			requestedModel: input.requestedModel,
			resolvedModel: input.resolvedModel,
			resolvedAlias: input.resolvedAlias,
			autoRouted: input.autoRouted,
			risk: input.risk,
			mode: input.mode,
			success: input.success,
			contextSource,
		});

		const event: UsageEvent = {
			timestamp: Date.now(),
			requestedModel: input.requestedModel ?? "",
			resolvedModel: input.resolvedModel,
			...(input.resolvedAlias ? { resolvedAlias: input.resolvedAlias } : {}),
			autoRouted: input.autoRouted,
			routeKind,
			mode: input.mode,
			brevity: input.brevity,
			risk,
			contextSource,
			contextChars: input.contextChars,
			maxOutputChars: input.maxOutputChars,
			success: input.success,
			truncated: input.truncated ?? false,
		};

		store.record(event);
	}

	function renderSummary(): string {
		const snap = store.snapshot();
		const summary = buildUsageSummary(snap);
		return formatUsageSummaryText(summary);
	}

	function snapshot(): { totals: UsageBudgetState } {
		return { totals: store.snapshot().totals };
	}

	function reset(): void {
		store.reset();
	}

	return { recordFromRequest, renderSummary, reset, snapshot };
}

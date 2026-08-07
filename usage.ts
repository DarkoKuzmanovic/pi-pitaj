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
	snapshot: () => { totals: UsageBudgetState; events: readonly UsageEvent[] };
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
		const classificationInput = {
			requestedModel: input.requestedModel,
			resolvedModel: input.resolvedModel,
			resolvedAlias: input.resolvedAlias,
			autoRouted: input.autoRouted,
			risk: input.risk,
			mode: input.mode,
			contextSource,
		};
		const classification = classifyUsageEvent({ ...classificationInput, success: input.success });
		// A failed event remains an error route, but its risk still describes the
		// effective resolved route rather than being replaced by the error sentinel.
		const effectiveClassification = input.success
			? classification
			: classifyUsageEvent({ ...classificationInput, success: true });

		const event: UsageEvent = {
			timestamp: Date.now(),
			requestedModel: input.requestedModel ?? "",
			resolvedModel: input.resolvedModel,
			...(input.resolvedAlias ? { resolvedAlias: input.resolvedAlias } : {}),
			autoRouted: input.autoRouted,
			routeKind: classification.routeKind,
			mode: input.mode,
			brevity: input.brevity,
			risk: effectiveClassification.risk,
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

	function snapshot(): { totals: UsageBudgetState; events: readonly UsageEvent[] } {
		const snap = store.snapshot();
		return { totals: snap.totals, events: snap.events };
	}

	function reset(): void {
		store.reset();
	}

	return { recordFromRequest, renderSummary, reset, snapshot };
}

export interface TokenUsage {
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
	cacheWriteHourTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	requests: number;
	contextTokens: number;
}
export interface ModelUsage extends TokenUsage {
	model: string;
	longContext: boolean;
	fast: boolean;
}
export interface TurnResult {
	id: string;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	durationSource: "provider" | "timestamps";
	prompts: string[];
	response: string;
	usage: ModelUsage[];
	files: { path: string; diff: string; added: number; removed: number; truncated: boolean }[];
	toolCalls: number;
	updatedAt: string;
}

export function mergeModelUsage(list: ModelUsage[]): ModelUsage[] {
	const result: ModelUsage[] = [];
	for (const u of list) {
		let sum = result.find(
			(v) => v.model === u.model && v.longContext === u.longContext && v.fast === u.fast,
		);
		if (!sum) {
			sum = { ...u };
			result.push(sum);
		} else {
			for (const key of [
				"inputTokens",
				"cachedInputTokens",
				"cacheWriteTokens",
				"cacheWriteHourTokens",
				"outputTokens",
				"reasoningTokens",
				"requests",
			] as const)
				sum[key] += u[key];
			sum.contextTokens = Math.max(sum.contextTokens, u.contextTokens);
		}
	}
	return result;
}
export interface ExpensiveTask {
	sessionId: string;
	sessionName: string;
	host: string;
	turnId: string;
	prompt: string;
	usage: ModelUsage[];
	toolCalls: number;
	durationMs: number | null;
}
export interface CostOverviewData {
	rankedTurns: number;
	tasks: ExpensiveTask[];
	sessions: ExpensiveTask[];
	turnCount: number;
	known: number;
	unknownTokens: number;
	unreportedTurns: number;
}

export interface SessionTelemetry {
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	totalTokens: number;
	contextTokens: number | null;
	contextWindow: number | null;
	updatedAt: string;
	source: "codex_transcript" | "claude_transcript";
}

export function codexTelemetry(info: unknown, updatedAt: string): SessionTelemetry | null {
	if (!info || typeof info !== "object") return null;
	const data = info as Record<string, unknown>;
	if (!data.total_token_usage || typeof data.total_token_usage !== "object") return null;
	const total = data.total_token_usage as Record<string, unknown>;
	const last = data.last_token_usage as Record<string, unknown> | null;
	const num = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
	return {
		inputTokens: num(total.input_tokens),
		cachedInputTokens: num(total.cached_input_tokens),
		cacheWriteTokens: num(total.cache_write_input_tokens),
		outputTokens: num(total.output_tokens),
		reasoningTokens: num(total.reasoning_output_tokens),
		totalTokens: num(total.total_tokens),
		contextTokens: last && typeof last === "object" ? num(last.input_tokens) : null,
		contextWindow: num(data.model_context_window) || null,
		updatedAt,
		source: "codex_transcript",
	};
}

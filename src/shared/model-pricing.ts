import type { ModelUsage } from "./session-results.js";
export const PRICE_CHECKED_AT = "2026-09-15";
export const OPENAI_PRICE_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const CLAUDE_PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export interface ModelPrice {
	input: number;
	read: number;
	write: number;
	hourWrite: number;
	output: number;
	source: string;
}
const openai: Record<string, number[]> = {
	"gpt-5.5": [5, 0.5, 0, 30],
	"gpt-6-astra": [10, 1, 12.5, 50],
	"gpt-5.6-sol": [4, 0.4, 5, 20],
	"gpt-5.6-terra": [2, 0.2, 2.5, 12],
	"gpt-5.6-luna": [0.2, 0.02, 0.25, 1.2],
};
const claude: Record<string, number[]> = {
	"claude-fable-5-1": [10, 0.25, 12.5, 20, 50],
	"claude-mythos-5-1": [10, 0.25, 12.5, 20, 50],
	"claude-fable-5": [10, 1, 12.5, 20, 50],
	"claude-mythos-5": [10, 1, 12.5, 20, 50],
	"claude-opus-5": [5, 0.5, 6.25, 10, 25],
	"claude-opus-4-8": [5, 0.5, 6.25, 10, 25],
	"claude-opus-4-7": [5, 0.5, 6.25, 10, 25],
	"claude-opus-4-6": [5, 0.5, 6.25, 10, 25],
	"claude-opus-4-5": [5, 0.5, 6.25, 10, 25],
	"claude-sonnet-5": [2, 0.2, 2.5, 4, 10],
	"claude-sonnet-4-6": [3, 0.3, 3.75, 6, 15],
	"claude-sonnet-4-5": [3, 0.3, 3.75, 6, 15],
	"claude-haiku-4-5": [1, 0.1, 1.25, 2, 5],
};
export function modelPrice(model: string, longContext = false, fast = false): ModelPrice | null {
	const key = model
		.toLowerCase()
		.replace(/\./g, "-")
		.replace(/-\d{8}$/, "");
	const o = openai[model.toLowerCase()];
	if (o) {
		const multiplier = fast ? 2 : 1;
		return {
			input: o[0] * (longContext ? 2 : 1) * multiplier,
			read: o[1] * (longContext ? 2 : 1) * multiplier,
			write: o[2] * (longContext ? 2 : 1) * multiplier,
			hourWrite: 0,
			output: o[3] * (longContext ? 1.5 : 1) * multiplier,
			source: OPENAI_PRICE_SOURCE,
		};
	}
	const c = claude[key];
	// Fast Claude and legacy long-context premiums are not assumed from incomplete reports.
	if (
		!c ||
		(fast && !["claude-opus-5", "claude-opus-4-8"].includes(key)) ||
		(longContext &&
			![
				"claude-opus-5",
				"claude-sonnet-5",
				"claude-fable-5-1",
				"claude-mythos-5-1",
				"claude-opus-4-6",
				"claude-opus-4-7",
				"claude-opus-4-8",
			].includes(key))
	)
		return null;
	const multiplier = fast ? 2 : 1;
	return {
		input: c[0] * multiplier,
		read: c[1] * multiplier,
		write: c[2] * multiplier,
		hourWrite: c[3] * multiplier,
		output: c[4] * multiplier,
		source: CLAUDE_PRICE_SOURCE,
	};
}
export function usageCost(u: ModelUsage) {
	const price = modelPrice(u.model, u.longContext, u.fast);
	const tokens = [
		Math.max(0, u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens),
		u.cachedInputTokens,
		Math.max(0, u.cacheWriteTokens - u.cacheWriteHourTokens),
		u.cacheWriteHourTokens,
		u.outputTokens,
	];
	const rates = price
		? [price.input, price.read, price.write, price.hourWrite, price.output]
		: null;
	const charges = rates?.map((r, i) => (tokens[i] * r) / 1e6) ?? null;
	return { price, tokens, rates, charges, total: charges?.reduce((a, b) => a + b, 0) ?? null };
}
export function costTotal(usage: ModelUsage[]) {
	let known = 0;
	let unknownTokens = 0;
	for (const u of usage) {
		const c = usageCost(u);
		if (c.total == null) unknownTokens += u.inputTokens + u.outputTokens;
		else known += c.total;
	}
	return { known, unknownTokens, complete: usage.length > 0 && unknownTokens === 0 };
}
export function costDrivers(usage: ModelUsage[]) {
	const costs = [0, 0, 0, 0, 0];
	let requests = 0;
	let input = 0;
	let cached = 0;
	let context = 0;
	for (const u of usage) {
		requests += u.requests;
		input += u.inputTokens;
		cached += u.cachedInputTokens;
		context = Math.max(context, u.contextTokens);
		usageCost(u).charges?.forEach((v, i) => {
			costs[i] += v;
		});
	}
	const names = [
		"Uncached input",
		"Cache reads",
		"5-minute cache writes",
		"1-hour cache writes",
		"Output",
	];
	const max = costs.indexOf(Math.max(...costs));
	const sum = costs.reduce((a, b) => a + b, 0);
	return `${sum ? `${names[max]} account for ${Math.round((costs[max] / sum) * 100)}% of priced cost. ` : ""}${requests.toLocaleString()} model requests; largest context ${context.toLocaleString()} tokens; ${input ? Math.round((cached / input) * 100) : 0}% input cache hits.`;
}

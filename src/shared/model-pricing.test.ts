import { expect, test } from "bun:test";
import { costTotal, modelPrice, usageCost } from "./model-pricing.js";
import type { ModelUsage } from "./session-results.js";
const u: ModelUsage = {
	model: "gpt-5.6-sol",
	inputTokens: 1000000,
	cachedInputTokens: 700000,
	cacheWriteTokens: 100000,
	cacheWriteHourTokens: 0,
	outputTokens: 100000,
	reasoningTokens: 40000,
	requests: 5,
	contextTokens: 200000,
	longContext: false,
	fast: false,
};
test("input/cache categories partition input and reasoning is not double billed", () => {
	const c = usageCost(u);
	expect(c.tokens).toEqual([200000, 700000, 100000, 0, 100000]);
	expect(c.total).toBeCloseTo(0.8 + 0.28 + 0.5 + 2);
});
test("Claude 1h cache writes use their own rate", () => {
	const c = usageCost({ ...u, model: "claude-sonnet-5", cacheWriteHourTokens: 50000 });
	expect(c.rates).toEqual([2, 0.2, 2.5, 4, 10]);
	expect(c.tokens[2]).toBe(50000);
});
test("mixed unknown models are marked partially priced", () => {
	const c = costTotal([u, { ...u, model: "unpublished-model" }]);
	expect(c.complete).toBe(false);
	expect(c.unknownTokens).toBe(1100000);
	expect(modelPrice("claude-sonnet-5-20260801")?.input).toBe(2);
});
test("long context and fast OpenAI rates apply separately", () => {
	expect(modelPrice("gpt-5.6-sol", true, true)?.output).toBe(60);
});

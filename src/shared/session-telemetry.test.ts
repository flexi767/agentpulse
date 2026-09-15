import { expect, test } from "bun:test";
import { codexTelemetry } from "./session-telemetry.js";

test("Codex totals exclude double-counting cached input and reasoning", () => {
	const t = codexTelemetry(
		{
			total_token_usage: {
				input_tokens: 1000,
				cached_input_tokens: 700,
				output_tokens: 200,
				reasoning_output_tokens: 50,
				total_tokens: 1200,
			},
			last_token_usage: { input_tokens: 300 },
			model_context_window: 2000,
		},
		"2026-09-15T00:00:00Z",
	);
	expect(t?.totalTokens).toBe(1200);
	expect(t?.contextTokens).toBe(300);
	expect(t?.contextWindow).toBe(2000);
});
test("null usage is not a zero-token report", () => {
	expect(codexTelemetry(null, "now")).toBeNull();
	expect(codexTelemetry({ total_token_usage: null }, "now")).toBeNull();
});

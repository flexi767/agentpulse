import { beforeAll, beforeEach, expect, test } from "bun:test";
import "../db/__test_db.js";
import { eq } from "drizzle-orm";
import type { TurnResult } from "../../shared/session-results.js";
import { getDb, initializeDatabase } from "../db/client.js";
import { events, sessions } from "../db/schema/index.js";
import { getSessionResults, saveSessionResults } from "./session-results.js";
beforeAll(async () => {
	await initializeDatabase();
});
beforeEach(async () => {
	await getDb().delete(events);
	await getDb().delete(sessions);
	await getDb()
		.insert(sessions)
		.values({
			sessionId: "result-test",
			agentType: "codex_cli",
			metadata: { hostName: "worker-a", feedback: [{ id: "preserved" }] },
		});
});
const r: TurnResult = {
	id: "turn-a",
	startedAt: "2026-09-15T10:00:00Z",
	completedAt: "2026-09-15T10:20:08Z",
	durationMs: 1208000,
	durationSource: "provider",
	prompts: ["Fix it"],
	response: "Done",
	usage: [
		{
			model: "gpt-5.6-sol",
			inputTokens: 100,
			cachedInputTokens: 70,
			cacheWriteTokens: 0,
			cacheWriteHourTokens: 0,
			outputTokens: 20,
			reasoningTokens: 5,
			requests: 1,
			contextTokens: 100,
			longContext: false,
			fast: false,
		},
	],
	files: [{ path: "parser.ts", diff: "-old\n+new", added: 1, removed: 1, truncated: false }],
	toolCalls: 1,
	updatedAt: "2026-09-15T10:20:08Z",
};
test("turn results are host scoped, idempotent, and preserve feedback", async () => {
	expect(await saveSessionResults("result-test", "worker-b", [r])).toBe(false);
	await saveSessionResults("result-test", "worker-a", [r]);
	await saveSessionResults("result-test", "worker-a", [r]);
	expect(await getSessionResults("result-test")).toEqual([r]);
	const [s] = await getDb().select().from(sessions).where(eq(sessions.sessionId, "result-test"));
	expect(s.metadata?.feedback).toEqual([{ id: "preserved" }]);
	expect(s.metadata?.resultTurns).toBe(1);
	expect((s.metadata?.costUsage as { inputTokens: number }[])[0].inputTokens).toBe(100);
});
test("stale results cannot replace the final response", async () => {
	await saveSessionResults("result-test", "worker-a", [r]);
	await saveSessionResults("result-test", "worker-a", [
		{ ...r, response: "old", updatedAt: r.startedAt },
	]);
	expect((await getSessionResults("result-test"))[0].response).toBe("Done");
});
test("rejects malformed usage", async () => {
	expect(
		saveSessionResults("result-test", "worker-a", [
			{ ...r, usage: [{ ...r.usage[0], inputTokens: -1 }] },
		]),
	).rejects.toThrow();
});

test("cost overview is manage-only despite the generic observe session-detail template", async () => {
	const { classifyRoute } = await import("../auth/route-scope-policy.js");
	expect(classifyRoute("GET", "/api/v1/sessions/costs")).toBe("manage");
	expect(classifyRoute("GET", "/api/v1/sessions/result-test/results")).toBe("manage");
});

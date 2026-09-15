import { beforeAll, beforeEach, expect, test } from "bun:test";
import "../db/__test_db.js";
import { eq } from "drizzle-orm";
import { getDb, getSqlite, initializeDatabase } from "../db/client.js";
import { sessions } from "../db/schema/index.js";
import {
	type SessionFeedback,
	acknowledgeSessionFeedback,
	claimSessionFeedback,
	queueSessionFeedback,
	setSessionHost,
	updateSessionTelemetry,
} from "./session-feedback.js";

beforeAll(async () => {
	await initializeDatabase();
});
beforeEach(async () => {
	await getDb().delete(sessions);
	await getDb()
		.insert(sessions)
		.values({
			sessionId: "feedback-test",
			agentType: "codex_cli",
			metadata: { hostName: "worker-a", preserved: true },
		});
});
test("feedback is host scoped, leased, and acknowledged", async () => {
	const f = await queueSessionFeedback("feedback-test", "Please inspect the failure.");
	expect(await claimSessionFeedback("feedback-test", "worker-b")).toEqual([]);
	expect((await claimSessionFeedback("feedback-test", "worker-a"))[0]?.id).toBe(f.id);
	expect(await claimSessionFeedback("feedback-test", "worker-a")).toEqual([]);
	await acknowledgeSessionFeedback("feedback-test", "worker-a", [f.id]);
	const [row] = await getDb()
		.select()
		.from(sessions)
		.where(eq(sessions.sessionId, "feedback-test"));
	expect((row.metadata?.feedback as SessionFeedback[])[0].status).toBe("delivered");
	expect(row.metadata?.preserved).toBe(true);
});
test("concurrent host and feedback updates preserve the queue", async () => {
	await Promise.all([
		queueSessionFeedback("feedback-test", "first"),
		queueSessionFeedback("feedback-test", "second"),
		setSessionHost("feedback-test", "worker-a"),
	]);
	const first = await claimSessionFeedback("feedback-test", "worker-a");
	const second = await claimSessionFeedback("feedback-test", "worker-a");
	expect([...first, ...second].map((f) => f.text).sort()).toEqual(["first", "second"]);
});
test("telemetry does not change lifecycle state or accept a wrong host", async () => {
	const t = {
		inputTokens: 100,
		cachedInputTokens: 70,
		cacheWriteTokens: 0,
		outputTokens: 20,
		reasoningTokens: 5,
		totalTokens: 120,
		contextTokens: 80,
		contextWindow: 1000,
		source: "codex_transcript",
		updatedAt: new Date().toISOString(),
	};
	expect(await updateSessionTelemetry("feedback-test", "worker-b", "example", t)).toBe(false);
	expect(await updateSessionTelemetry("feedback-test", "worker-a", "example", t)).toBe(true);
	const [row] = await getDb()
		.select()
		.from(sessions)
		.where(eq(sessions.sessionId, "feedback-test"));
	expect(row.model).toBe("example");
	expect(row.metadata?.telemetry).toEqual(t);
	expect(row.metadata?.preserved).toBe(true);
});

test("expired feedback leases retry and formatted JSON metadata is preserved", async () => {
	getSqlite()
		.query("UPDATE sessions SET metadata = ? WHERE session_id = ?")
		.run('{ "hostName": "worker-a", "preserved": true }', "feedback-test");
	const f = await queueSessionFeedback("feedback-test", "retry me");
	await claimSessionFeedback("feedback-test", "worker-a");
	const [row] = await getDb()
		.select()
		.from(sessions)
		.where(eq(sessions.sessionId, "feedback-test"));
	const list = row.metadata?.feedback as SessionFeedback[];
	list[0].leaseUntil = "2000-01-01T00:00:00Z";
	await getDb()
		.update(sessions)
		.set({ metadata: { ...row.metadata, feedback: list } })
		.where(eq(sessions.sessionId, "feedback-test"));
	expect((await claimSessionFeedback("feedback-test", "worker-a"))[0]?.id).toBe(f.id);
});
test("historical telemetry cannot replace a newer report", async () => {
	const t = {
		inputTokens: 100,
		cachedInputTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 20,
		reasoningTokens: 0,
		totalTokens: 120,
		contextTokens: 80,
		contextWindow: 1000,
		source: "codex_transcript",
		updatedAt: "2026-09-15T00:00:00Z",
	};
	await updateSessionTelemetry("feedback-test", "worker-a", "example", t);
	expect(
		await updateSessionTelemetry("feedback-test", "worker-a", "old", {
			...t,
			totalTokens: 10,
			updatedAt: "2026-09-14T00:00:00Z",
		}),
	).toBe(false);
	const [row] = await getDb()
		.select()
		.from(sessions)
		.where(eq(sessions.sessionId, "feedback-test"));
	expect(row.model).toBe("example");
	expect((row.metadata?.telemetry as { totalTokens: number }).totalTokens).toBe(120);
});

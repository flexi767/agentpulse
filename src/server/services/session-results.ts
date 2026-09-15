import { and, desc, eq } from "drizzle-orm";
import { type TurnResult, mergeModelUsage } from "../../shared/session-results.js";
import { getDb } from "../db/client.js";
import { events, sessions } from "../db/schema/index.js";
import { mutateSession } from "./session-feedback.js";
const resultWhere = (id: string) =>
	and(eq(events.sessionId, id), eq(events.providerEventType, "agentpulse_turn_result"));
export async function getSessionResults(sessionId: string) {
	const rows = await getDb()
		.select({ result: events.rawPayload })
		.from(events)
		.where(resultWhere(sessionId))
		.orderBy(desc(events.createdAt));
	return rows.map((r) => r.result as unknown as TurnResult);
}
export async function saveSessionResults(sessionId: string, host: string, results: TurnResult[]) {
	const [session] = await getDb().select().from(sessions).where(eq(sessions.sessionId, sessionId));
	if (!session || session.metadata?.hostName !== host) return false;
	if (!Array.isArray(results) || results.length > 100) throw new Error("Invalid turn batch");
	const rows = await getDb().select().from(events).where(resultWhere(sessionId));
	for (const r of results) {
		if (
			!r ||
			typeof r.id !== "string" ||
			r.id.length > 200 ||
			!Number.isFinite(Date.parse(r.updatedAt)) ||
			!Number.isFinite(Date.parse(r.startedAt)) ||
			!Array.isArray(r.prompts) ||
			!r.prompts.every((p) => typeof p === "string") ||
			typeof r.response !== "string" ||
			!Array.isArray(r.files) ||
			r.files.length > 256 ||
			!r.files.every(
				(f) =>
					typeof f.path === "string" &&
					typeof f.diff === "string" &&
					Number.isFinite(f.added) &&
					f.added >= 0 &&
					Number.isFinite(f.removed) &&
					f.removed >= 0,
			) ||
			!Array.isArray(r.usage) ||
			!r.usage.every(
				(u) =>
					typeof u.model === "string" &&
					[
						u.inputTokens,
						u.cachedInputTokens,
						u.cacheWriteTokens,
						u.cacheWriteHourTokens,
						u.outputTokens,
						u.reasoningTokens,
						u.requests,
						u.contextTokens,
					].every((v) => Number.isFinite(v) && v >= 0),
			) ||
			JSON.stringify(r).length > 2 * 1024 * 1024
		)
			throw new Error("Invalid turn result");
		const existing = rows.find((e) => e.rawPayload.id === r.id);
		if (existing && Date.parse(String(existing.rawPayload.updatedAt)) > Date.parse(r.updatedAt))
			continue;
		const rawPayload = r as unknown as Record<string, unknown>;
		if (existing)
			await getDb().update(events).set({ rawPayload }).where(eq(events.id, existing.id));
		else
			await getDb().insert(events).values({
				sessionId,
				eventType: "TurnResult",
				category: null,
				source: "observed_transcript",
				isNoise: true,
				providerEventType: "agentpulse_turn_result",
				rawPayload,
				createdAt: r.startedAt,
			});
	}
	const all = await getSessionResults(sessionId);
	const usage = mergeModelUsage(all.flatMap((r) => r.usage));
	await mutateSession(sessionId, (row) => ({
		result: true,
		updates: row
			? {
					metadata: {
						...row.metadata,
						costUsage: usage,
						resultTurns: all.length,
						resultUnreportedTurns: all.filter((r) => !r.usage.length).length,
						resultToolCalls: all.reduce((n, r) => n + r.toolCalls, 0),
						resultDurationMs: all.reduce((n, r) => n + (r.durationMs ?? 0), 0),
					},
				}
			: undefined,
	}));
	return true;
}

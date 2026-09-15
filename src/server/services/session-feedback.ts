import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { sessions } from "../db/schema/index.js";

type SessionRow = typeof sessions.$inferSelect;
// Retry stale metadata snapshots so concurrent hooks cannot erase feedback.
export async function mutateSession<T>(
	sessionId: string,
	change: (row: SessionRow | undefined) => { result: T; updates?: Partial<SessionRow> },
): Promise<T> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const db = getDb();
		const [row] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.sessionId, sessionId))
			.limit(1);
		const { result, updates } = change(row);
		if (!updates || !row) return result;
		const unchanged =
			row.metadata == null
				? isNull(sessions.metadata)
				: config.dialect === "sqlite"
					? sql`json(${sessions.metadata}) = json(${JSON.stringify(row.metadata)})`
					: eq(sessions.metadata, row.metadata);
		const updated = await db
			.update(sessions)
			.set(updates)
			.where(and(eq(sessions.sessionId, sessionId), unchanged))
			.returning({ id: sessions.id });
		if (updated.length) return result;
	}
	throw new Error("Session changed repeatedly; retry the request.");
}

export async function setSessionHost(sessionId: string, hostName: string) {
	return mutateSession(sessionId, (row) =>
		row
			? { result: true, updates: { metadata: { ...row.metadata, hostName } } }
			: { result: false },
	);
}

export interface SessionFeedback {
	id: string;
	text: string;
	status: "queued" | "delivered";
	createdAt: string;
	deliveredAt?: string;
	leaseUntil?: string;
}

export async function queueSessionFeedback(sessionId: string, text: string) {
	const clean = text.trim();
	if (!clean || clean.length > 16000) throw new Error("Feedback must contain 1–16000 characters.");
	return mutateSession(sessionId, (row) => {
		if (!row) throw new Error("Session not found.");
		if (!row.metadata?.hostName) throw new Error("Session host is not known yet.");
		const list = (row.metadata?.feedback ?? []) as SessionFeedback[];
		if (list.filter((f) => f.status === "queued").length >= 20)
			throw new Error("Feedback queue is full.");
		const feedback: SessionFeedback = {
			id: crypto.randomUUID(),
			text: clean,
			status: "queued",
			createdAt: new Date().toISOString(),
		};
		return {
			result: feedback,
			updates: { metadata: { ...row.metadata, feedback: [...list.slice(-99), feedback] } },
		};
	});
}

export async function claimSessionFeedback(sessionId: string, hostName: string) {
	return mutateSession(sessionId, (row) => {
		if (!row || row.metadata?.hostName !== hostName) return { result: [] as SessionFeedback[] };
		const list = (row.metadata?.feedback ?? []) as SessionFeedback[];
		const pending = list
			.filter(
				(f) => f.status === "queued" && (!f.leaseUntil || Date.parse(f.leaseUntil) < Date.now()),
			)
			.slice(0, 1);
		if (!pending.length) return { result: [] as SessionFeedback[] };
		const ids = new Set(pending.map((f) => f.id));
		const leaseUntil = new Date(Date.now() + 60000).toISOString();
		return {
			result: pending,
			updates: {
				metadata: {
					...row.metadata,
					feedback: list.map((f) => (ids.has(f.id) ? { ...f, leaseUntil } : f)),
				},
			},
		};
	});
}

export async function acknowledgeSessionFeedback(
	sessionId: string,
	hostName: string,
	ids: string[],
) {
	return mutateSession(sessionId, (row) => {
		if (!row || row.metadata?.hostName !== hostName) return { result: false };
		const list = (row.metadata?.feedback ?? []) as SessionFeedback[];
		return {
			result: true,
			updates: {
				metadata: {
					...row.metadata,
					feedback: list.map((f) =>
						ids.includes(f.id) && f.leaseUntil
							? { ...f, status: "delivered", deliveredAt: new Date().toISOString() }
							: f,
					),
				},
			},
		};
	});
}

export async function updateSessionTelemetry(
	sessionId: string,
	hostName: string,
	model: unknown,
	telemetry: unknown,
	observedAt?: string,
) {
	return mutateSession(sessionId, (row) => {
		if (!row || row.metadata?.hostName !== hostName) return { result: false };
		const updates: Partial<SessionRow> = {};
		if (typeof model === "string" && model.trim()) {
			const at = observedAt || new Date().toISOString();
			const previous = row.metadata?.modelUpdatedAt;
			if (typeof previous !== "string" || Date.parse(at) >= Date.parse(previous)) {
				updates.model = model.trim().slice(0, 200);
				updates.metadata = { ...row.metadata, modelUpdatedAt: at };
			}
		}
		if (telemetry && typeof telemetry === "object") {
			const t = telemetry as Record<string, unknown>;
			const safe: Record<string, unknown> = {};
			for (const key of [
				"inputTokens",
				"cachedInputTokens",
				"cacheWriteTokens",
				"outputTokens",
				"reasoningTokens",
				"totalTokens",
				"contextTokens",
				"contextWindow",
			]) {
				const v = t[key];
				if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0))
					return { result: false };
				safe[key] = v;
			}
			if (!["codex_transcript", "claude_transcript"].includes(String(t.source)))
				return { result: false };
			safe.source = t.source;
			if (t.accounting === "responses") safe.accounting = "responses";
			safe.updatedAt = typeof t.updatedAt === "string" ? t.updatedAt : new Date().toISOString();
			const previous = row.metadata?.telemetry as
				| { updatedAt?: string; accounting?: string }
				| undefined;
			if (previous?.accounting === "responses" && safe.accounting !== "responses")
				return { result: false };
			if (!Number.isFinite(Date.parse(String(safe.updatedAt)))) return { result: false };
			if (
				previous?.updatedAt &&
				Date.parse(String(safe.updatedAt)) < Date.parse(previous.updatedAt)
			)
				return { result: false };
			if (safe.contextWindow == null && previous)
				safe.contextWindow = (previous as Record<string, unknown>).contextWindow ?? null;
			updates.metadata = { ...(updates.metadata ?? row.metadata), telemetry: safe };
		}
		if (!Object.keys(updates).length) return { result: false };
		return { result: true, updates };
	});
}

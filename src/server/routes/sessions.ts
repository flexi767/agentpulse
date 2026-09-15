import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { costTotal } from "../../shared/model-pricing.js";
import type { ExpensiveTask, ModelUsage, TurnResult } from "../../shared/session-results.js";
import type { AgentType, SessionStatus } from "../../shared/types.js";
import { type AuthUser, requireAuth } from "../auth/middleware.js";
import { callerHasManageScope, requireOperatorScope } from "../auth/route-scope-policy.js";
import { getDb } from "../db/client.js";
import { events, sessions } from "../db/schema/index.js";
import { withTransaction } from "../db/with-transaction.js";
import {
	listControlActionsForSession,
	queuePromptAction,
	queueStopAction,
	retryLaunchForSession,
} from "../services/control-actions.js";
import { queueSessionFeedback } from "../services/session-feedback.js";
import { getSessionResults } from "../services/session-results.js";
import {
	applyNativeName,
	getSession,
	getSessions,
	getStats,
	renameSession,
} from "../services/session-tracker.js";

const sessionsRouter = new Hono();
sessionsRouter.use("*", requireAuth());
// Session data is operator-only. Ingest keys must not list session history,
// read event timelines, or mutate session state (rename, notes, archive).
// Relay users must use a manage-scoped key (see scripts/setup-relay.sh).
// requireOperatorScope() additionally recognizes observe-scoped keys on the
// read-only routes in OBSERVE_READ_PATHS (list, detail, timeline, event
// context, claude-md); mutating routes and control-actions stay manage-only.
sessionsRouter.use("*", requireOperatorScope());

sessionsRouter.post("/sessions/:sessionId/feedback", async (c) => {
	try {
		const body = await c.req.json<{ text?: string }>();
		if (typeof body.text !== "string") return c.json({ error: "Feedback text is required." }, 400);
		const feedback = await queueSessionFeedback(c.req.param("sessionId"), body.text);
		return c.json({ feedback }, 201);
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : "Cannot queue feedback." },
			400,
		);
	}
});

// GET /api/v1/sessions - List sessions
sessionsRouter.get("/sessions", async (c) => {
	const status = c.req.query("status") as SessionStatus | undefined;
	const agentType = c.req.query("agent_type") as AgentType | undefined;
	const projectId = c.req.query("projectId") as string | undefined;
	const limit = Number(c.req.query("limit") || 50);
	const offset = Number(c.req.query("offset") || 0);

	const result = await getSessions({ status, agentType, projectId, limit, offset });
	return c.json(result);
});

// GET /api/v1/sessions/stats - Dashboard stats
sessionsRouter.get("/sessions/stats", async (c) => {
	const stats = await getStats();
	return c.json(stats);
});

sessionsRouter.get("/sessions/:sessionId/results", async (c) =>
	c.json({ turns: await getSessionResults(c.req.param("sessionId")) }),
);

sessionsRouter.get("/sessions/costs", async (c) => {
	const rows = await getDb()
		.select({
			raw: events.rawPayload,
			sessionId: events.sessionId,
			name: sessions.displayName,
			metadata: sessions.metadata,
		})
		.from(events)
		.innerJoin(sessions, eq(sessions.sessionId, events.sessionId))
		.where(eq(events.providerEventType, "agentpulse_turn_result"))
		.orderBy(desc(events.createdAt))
		.limit(5000);
	const sessionRows = await getDb()
		.select({ id: sessions.sessionId, name: sessions.displayName, metadata: sessions.metadata })
		.from(sessions);
	let known = 0;
	let unknownTokens = 0;
	let turnCount = 0;
	let unreportedTurns = 0;
	const expensiveSessions: ExpensiveTask[] = sessionRows
		.map((s) => {
			const usage = (s.metadata?.costUsage ?? []) as ModelUsage[];
			const cost = costTotal(usage);
			known += cost.known;
			unknownTokens += cost.unknownTokens;
			turnCount += Number(s.metadata?.resultTurns ?? 0);
			unreportedTurns += Number(s.metadata?.resultUnreportedTurns ?? 0);
			return {
				sessionId: s.id,
				sessionName: s.name || s.id,
				host: String(s.metadata?.hostName || "Unknown"),
				turnId: "",
				prompt: s.name || s.id,
				usage,
				toolCalls: Number(s.metadata?.resultToolCalls ?? 0),
				durationMs: Number(s.metadata?.resultDurationMs ?? 0),
			};
		})
		.filter((s) => costTotal(s.usage).known > 0)
		.sort((a, b) => costTotal(b.usage).known - costTotal(a.usage).known)
		.slice(0, 10);
	const tasks = rows
		.map((row) => {
			const r = row.raw as unknown as TurnResult;
			const cost = costTotal(r.usage);
			return {
				sessionId: row.sessionId,
				sessionName: row.name || row.sessionId,
				host: String(row.metadata?.hostName || "Unknown"),
				turnId: r.id,
				prompt: r.prompts.join("\n"),
				usage: r.usage,
				toolCalls: r.toolCalls,
				durationMs: r.durationMs,
				cost: cost.known,
			};
		})
		.filter((t) => t.cost > 0)
		.sort((a, b) => b.cost - a.cost)
		.slice(0, 10);
	return c.json({
		tasks,
		sessions: expensiveSessions,
		turnCount,
		rankedTurns: rows.length,
		known,
		unknownTokens,
		unreportedTurns,
	});
});

// GET /api/v1/sessions/:sessionId - Session detail
sessionsRouter.get("/sessions/:sessionId", async (c: Context) => {
	const sessionId = c.req.param("sessionId");
	const session = await getSession(sessionId);

	if (!session) {
		return c.json({ error: "Session not found" }, 404);
	}

	// Get timeline events for the detail page; the UI handles mode filtering.
	const sessionEvents = await getDb()
		.select()
		.from(events)
		.where(
			and(
				eq(events.sessionId, sessionId),
				sql`(${events.providerEventType} IS NULL OR ${events.providerEventType} != 'agentpulse_turn_result')`,
			),
		)
		.orderBy(desc(events.createdAt))
		.limit(500);

	// C1: controlActions metadata carries the injected prompt and launch.env
	// (control-actions.ts:187-194). An observe-scoped caller may read session
	// detail (it's in OBSERVE_READ_PATHS) but must not see this embed.
	const authUser = c.get("authUser") as AuthUser | undefined;
	const controlActions = callerHasManageScope(authUser)
		? await listControlActionsForSession(sessionId)
		: undefined;

	return c.json({ session, events: sessionEvents, controlActions });
});

// GET /api/v1/sessions/:sessionId/timeline - Paginated event timeline
sessionsRouter.get("/sessions/:sessionId/timeline", async (c) => {
	const sessionId = c.req.param("sessionId");
	const limit = Number(c.req.query("limit") || 50);
	const offset = Number(c.req.query("offset") || 0);

	const sessionEvents = await getDb()
		.select()
		.from(events)
		.where(
			and(
				eq(events.sessionId, sessionId),
				sql`(${events.providerEventType} IS NULL OR ${events.providerEventType} != 'agentpulse_turn_result')`,
			),
		)
		.orderBy(desc(events.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({ events: sessionEvents });
});

// PUT /api/v1/sessions/:sessionId/notes - Save notes for a session
sessionsRouter.put("/sessions/:sessionId/notes", async (c) => {
	const sessionId = c.req.param("sessionId");
	const { notes } = await c.req.json<{ notes: string }>();

	await getDb()
		.update(sessions)
		.set({ notes: notes ?? "" })
		.where(eq(sessions.sessionId, sessionId));

	return c.json({ ok: true });
});

// PUT /api/v1/sessions/:sessionId/rename - Rename a session
//
// Slice DELETE-RENAME-1: business logic lives in `renameSession`, which
// wraps the `sessions` + (optional) `managed_sessions` updates in a
// transaction. The route handler only validates input.
//
// `source` (F5 / Decision 6, optional; contract revised per codex r2
// Medium #1) records who initiated the rename. Only an explicit
// `source: "user"` stamps `metadata.renameSource = "user"`, which
// `applyNativeName` below checks to refuse a later native-name pull. An
// omitted `source` — or any other explicit value, e.g. the relay's Codex
// name-sync `source: "sync"` — is legacy-neutral: the rename happens but
// the flag is left untouched. This protects a mixed-version old relay
// (which sends `{ name }` with no `source` field) from being
// misclassified as a manual rename. The dashboard (src/web/lib/api.ts)
// and the Ask "rename X to Y" command both send `source: "user"`
// explicitly.
sessionsRouter.put("/sessions/:sessionId/rename", async (c) => {
	const sessionId = c.req.param("sessionId");
	const { name, source } = await c.req.json<{ name: string; source?: string }>();

	if (!name?.trim()) return c.json({ error: "Name required" }, 400);

	await renameSession(sessionId, name, { source });
	return c.json({ ok: true });
});

// PUT /api/v1/sessions/:sessionId/native-name - Pull-only sync (F5) of
// Claude Code's native session_name into displayName. Called by
// scripts/statusline.sh through the local relay on every render where the
// native name changed. Deliberately 404s on an unknown session — a
// departure from /rename's silent no-op-on-missing-row behavior — so the
// statusline caller can distinguish "not yet ingested, retry next render"
// from a successful call. See Decision 6 and applyNativeName for the
// manual-rename precedence rule.
sessionsRouter.put("/sessions/:sessionId/native-name", async (c) => {
	const sessionId = c.req.param("sessionId");
	const { name } = await c.req.json<{ name: string }>();

	if (!name?.trim()) return c.json({ error: "Name required" }, 400);

	const result = await applyNativeName(sessionId, name);
	if (!result.found) return c.json({ error: "Session not found" }, 404);

	return c.json({ ok: true, applied: result.applied });
});

sessionsRouter.get("/sessions/:sessionId/control-actions", async (c) => {
	const actions = await listControlActionsForSession(c.req.param("sessionId"));
	return c.json({ controlActions: actions });
});

sessionsRouter.post("/sessions/:sessionId/stop", async (c) => {
	try {
		const action = await queueStopAction(c.req.param("sessionId"));
		return c.json({ action }, 202);
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "Unable to queue stop" }, 400);
	}
});

sessionsRouter.post("/sessions/:sessionId/prompt", async (c) => {
	try {
		const body = await c.req.json<{ prompt?: string }>();
		const action = await queuePromptAction(c.req.param("sessionId"), body.prompt || "");
		return c.json({ action }, 202);
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : "Unable to queue prompt" },
			400,
		);
	}
});

sessionsRouter.post("/sessions/:sessionId/retry", async (c) => {
	try {
		const result = await retryLaunchForSession(c.req.param("sessionId"));
		return c.json(result, 201);
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "Unable to retry" }, 400);
	}
});

sessionsRouter.post("/sessions/:sessionId/fork", async (c) => {
	return c.json({ error: "Fork is not implemented yet for this provider." }, 501);
});

sessionsRouter.post("/sessions/:sessionId/resume", async (c) => {
	return c.json({ error: "Resume is not implemented yet for this provider." }, 501);
});

// PUT /api/v1/sessions/:sessionId/pin - Toggle pin
sessionsRouter.put("/sessions/:sessionId/pin", async (c) => {
	const sessionId = c.req.param("sessionId");
	const { pinned } = await c.req.json<{ pinned: boolean }>();

	await getDb().update(sessions).set({ isPinned: pinned }).where(eq(sessions.sessionId, sessionId));

	return c.json({ ok: true });
});

// Slice SEARCH-1: legacy GET /sessions/search was removed. The FTS5-backed
// `/api/v1/search?kinds=session&q=...` endpoint (see routes/search.ts) is the
// only supported session-search path now. Requests to the old URL fall
// through to `/sessions/:sessionId` with sessionId="search" and 404 with
// "Session not found", which is the expected behavior for the dead route.

// GET /api/v1/sessions/:sessionId/events/:eventId/context - Event context window
sessionsRouter.get("/sessions/:sessionId/events/:eventId/context", async (c) => {
	const sessionId = c.req.param("sessionId");
	const eventId = Number(c.req.param("eventId"));
	const rawAround = Number(c.req.query("around") ?? 20);
	const around = Math.max(1, Math.min(100, Number.isFinite(rawAround) ? rawAround : 20));

	if (!Number.isInteger(eventId) || eventId <= 0) {
		return c.json({ error: "Invalid eventId" }, 404);
	}

	// Verify the target event exists and belongs to this session.
	const [target] = await getDb()
		.select()
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.sessionId, sessionId)))
		.limit(1);

	if (!target) {
		return c.json({ error: "Event not found" }, 404);
	}

	// Events at or before the target (includes target itself), newest first.
	const before = await getDb()
		.select()
		.from(events)
		.where(and(eq(events.sessionId, sessionId), lte(events.id, eventId)))
		.orderBy(desc(events.id))
		.limit(around + 1);

	// Events strictly after the target, oldest first.
	const after = await getDb()
		.select()
		.from(events)
		.where(and(eq(events.sessionId, sessionId), gt(events.id, eventId)))
		.orderBy(asc(events.id))
		.limit(around);

	const combined = [...before.reverse(), ...after];

	return c.json({ events: combined, target: { id: eventId } });
});

// Compute a simple hash for sync detection
async function computeChecksum(content: string): Promise<string> {
	const data = new TextEncoder().encode(content);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 16);
}

// GET /api/v1/sessions/:sessionId/claude-md - Get CLAUDE.md content from DB
sessionsRouter.get("/sessions/:sessionId/claude-md", async (c) => {
	const sessionId = c.req.param("sessionId");
	const [session] = await getDb()
		.select({
			claudeMdContent: sessions.claudeMdContent,
			claudeMdPath: sessions.claudeMdPath,
			claudeMdChecksum: sessions.claudeMdChecksum,
			claudeMdUpdatedAt: sessions.claudeMdUpdatedAt,
		})
		.from(sessions)
		.where(eq(sessions.sessionId, sessionId))
		.limit(1);

	if (!session) return c.json({ error: "Session not found" }, 404);

	return c.json({
		content: session.claudeMdContent || "",
		path: session.claudeMdPath || "",
		checksum: session.claudeMdChecksum || "",
		updatedAt: session.claudeMdUpdatedAt || null,
	});
});

// PUT /api/v1/sessions/:sessionId/claude-md - Save CLAUDE.md content to DB
sessionsRouter.put("/sessions/:sessionId/claude-md", async (c) => {
	const sessionId = c.req.param("sessionId");
	const { content, path } = await c.req.json<{ content: string; path?: string }>();

	const now = new Date().toISOString();
	const checksum = await computeChecksum(content);
	const updates: Record<string, unknown> = {
		claudeMdContent: content,
		claudeMdChecksum: checksum,
		claudeMdUpdatedAt: now,
	};
	if (path) updates.claudeMdPath = path;

	await getDb().update(sessions).set(updates).where(eq(sessions.sessionId, sessionId));

	return c.json({ ok: true, checksum });
});

// PUT /api/v1/sessions/:sessionId/archive - Toggle archive flag (is_archived boolean)
sessionsRouter.put("/sessions/:sessionId/archive", async (c) => {
	const sessionId = c.req.param("sessionId");
	const body = await c.req.json<{ archived?: boolean }>().catch(() => ({ archived: true }));
	// Default to archiving (true) when the caller omits the field.
	const archived = (body as { archived?: boolean }).archived !== false;

	await getDb()
		.update(sessions)
		.set({ isArchived: archived })
		.where(eq(sessions.sessionId, sessionId));

	return c.json({ ok: true });
});

// DELETE /api/v1/sessions/:sessionId - Delete a session and its events
//
// Slice DB-1: child tables (events, managed_sessions, control_actions,
// watcher_proposals, ai_hitl_requests, ai_watcher_runs, watcher_configs)
// now reference sessions(session_id) ON DELETE CASCADE, so the single
// `delete(sessions)` is sufficient — both dialects drop children atomically
// via the cascade FK. The explicit `events` delete is belt-and-braces for
// older SQLite installs that haven't yet rebuilt FKs.
//
// We wrap the deletes in withTransaction() so any failure leaves the row
// in place rather than partially deleted.
sessionsRouter.delete("/sessions/:sessionId", async (c) => {
	const sessionId = c.req.param("sessionId");

	await withTransaction(async (tx) => {
		// Cascade does this; explicit for older DBs that haven't yet rebuilt FKs.
		await tx
			.delete(events)
			.where(
				and(
					eq(events.sessionId, sessionId),
					sql`(${events.providerEventType} IS NULL OR ${events.providerEventType} != 'agentpulse_turn_result')`,
				),
			);
		await tx.delete(sessions).where(eq(sessions.sessionId, sessionId));
	});

	return c.json({ ok: true });
});

export { sessionsRouter };

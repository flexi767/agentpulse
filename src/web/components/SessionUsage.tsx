import type { SessionTelemetry } from "../../shared/session-telemetry.js";
import type { Session } from "../../shared/types.js";

export function SessionUsage({
	session,
	compact = false,
}: { session: Session; compact?: boolean }) {
	const t = session.metadata?.telemetry as SessionTelemetry | undefined;
	const fmt = (n: number | null | undefined) => (n == null ? "Unknown" : n.toLocaleString());
	return (
		<div className="text-xs text-muted-foreground space-y-1">
			<div>
				Model: <span className="text-foreground">{session.model || "Unknown"}</span>
			</div>
			<div>Tokens used: {t ? fmt(t.totalTokens) : "Not reported yet"}</div>
			<div title="Input tokens in the latest model request, not cumulative session tokens.">
				Latest context: {t ? fmt(t.contextTokens) : "Unknown"}
				{t?.contextWindow
					? ` / ${fmt(t.contextWindow)} (${Math.round(((t.contextTokens ?? 0) / t.contextWindow) * 100)}%)`
					: " · limit unknown"}
			</div>
			{!compact && t && (
				<>
					<div>
						Input: {fmt(t.inputTokens)} · Output: {fmt(t.outputTokens)}
					</div>
					<div>
						Cache read: {fmt(t.cachedInputTokens)} · Cache write: {fmt(t.cacheWriteTokens)} ·
						Reasoning:{" "}
						{t.source === "claude_transcript" ? "Not separately reported" : fmt(t.reasoningTokens)}
					</div>
					<div>Transcript report: {new Date(t.updatedAt).toLocaleString()}</div>
					<p>
						Tokens are usage counts, not a monetary bill. Cache and reasoning tokens overlap the
						totals where reported by the provider. Context is the latest request snapshot.
					</p>
				</>
			)}
		</div>
	);
}

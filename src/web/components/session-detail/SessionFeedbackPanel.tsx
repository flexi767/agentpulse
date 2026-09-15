import { useEffect, useState } from "react";
import type { Session } from "../../../shared/types.js";
import { api } from "../../lib/api.js";

type Feedback = { id: string; text: string; status: string; createdAt: string };

export function SessionFeedbackPanel({
	session,
	onSubmitted,
}: { session: Session; onSubmitted: () => Promise<void> }) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<Feedback[]>([]);
	useEffect(() => {
		let cancelled = false;
		async function refresh() {
			try {
				const res = await api.getSession(session.sessionId);
				if (!cancelled) setFeedback((res.session.metadata?.feedback ?? []) as Feedback[]);
			} catch {}
		}
		refresh();
		const timer = setInterval(refresh, 5000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [session.sessionId]);
	async function send() {
		setSending(true);
		setError(null);
		try {
			await api.sendSessionFeedback(session.sessionId, text);
			setText("");
			await onSubmitted();
			const res = await api.getSession(session.sessionId);
			setFeedback((res.session.metadata?.feedback ?? []) as Feedback[]);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Feedback failed.");
		} finally {
			setSending(false);
		}
	}
	return (
		<div className="border-t border-border p-3 space-y-2">
			<p className="text-sm font-medium">Send feedback</p>
			<p className="text-xs text-muted-foreground">
				Delivered through the agent hook at its next tool call or prompt. Idle sessions keep it
				queued. Delivered means the hook emitted it, not that the agent acted on it.
			</p>
			<textarea
				aria-label="Session feedback"
				value={text}
				onChange={(e) => setText(e.target.value)}
				maxLength={16000}
				rows={2}
				className="w-full rounded border border-border bg-background p-2 text-sm"
			/>
			<button
				type="button"
				disabled={sending || !text.trim() || !session.metadata?.hostName}
				onClick={send}
				className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
			>
				{sending ? "Sending…" : "Queue feedback"}
			</button>
			{error && (
				<p role="alert" className="text-xs text-red-400">
					{error}
				</p>
			)}
			{feedback
				.slice(-5)
				.reverse()
				.map((f) => (
					<div key={f.id} className="text-xs">
						<span className="font-medium">
							{f.status === "delivered" ? "Delivered to hook" : "Queued"}
						</span>{" "}
						· {f.text}
					</div>
				))}
		</div>
	);
}

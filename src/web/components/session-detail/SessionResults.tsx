import { useEffect, useRef, useState } from "react";
import { costDrivers } from "../../../shared/model-pricing.js";
import type { TurnResult } from "../../../shared/session-results.js";
import { api } from "../../lib/api.js";
import { CostPopover } from "../CostPopover.js";
import { MarkdownContent } from "../MarkdownContent.js";
export function SessionResults({ sessionId }: { sessionId: string }) {
	const jumped = useRef(false);
	const [count, setCount] = useState(20);
	const [turns, setTurns] = useState<TurnResult[]>([]);
	const [error, setError] = useState("");
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let alive = true;
		let busy = false;
		async function load() {
			if (busy) return;
			busy = true;
			try {
				const r = await api.getSessionResults(sessionId);
				if (alive) {
					setTurns(r.turns);
					setError("");
					setLoaded(true);
				}
			} catch (e) {
				if (alive) setError(e instanceof Error ? e.message : "Cannot load results");
			} finally {
				busy = false;
			}
		}
		void load();
		const timer = setInterval(load, 5000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [sessionId]);
	useEffect(() => {
		if (jumped.current || !turns.length || !window.location.hash) return;
		const id = decodeURIComponent(window.location.hash.slice(1));
		const index = turns.findIndex((t) => `turn-${t.id}` === id);
		if (index >= count) {
			setCount(index + 1);
			return;
		}
		const element = document.getElementById(id);
		if (element) {
			element.scrollIntoView({ block: "start" });
			jumped.current = true;
		}
	}, [turns, count]);
	return (
		<div className="h-full overflow-auto p-3 md:p-6 space-y-5">
			<p className="text-xs text-muted-foreground">
				Prompts, results and changes recorded by the agent, grouped by turn. Only reported file
				changes appear here; shell edits may not have a recorded diff.
			</p>
			{error && (
				<p role="alert" className="text-amber-500">
					{error}
				</p>
			)}
			{!turns.length && (
				<p>
					{loaded
						? "No collected turns yet. Existing transcript history is being imported."
						: "Loading turn results…"}
				</p>
			)}
			{turns.slice(0, count).map((r) => (
				<article
					key={r.id}
					id={`turn-${r.id}`}
					className="rounded-xl border border-border bg-card overflow-hidden"
				>
					<div className="p-4 bg-muted/40 border-b border-border space-y-2">
						<div className="text-xs text-muted-foreground">
							Your prompt · {new Date(r.startedAt).toLocaleString()}
						</div>
						{r.prompts.length ? (
							r.prompts.map((p, i) => (
								<p key={`${r.id}-${i}`} className="whitespace-pre-wrap break-words">
									{p}
								</p>
							))
						) : (
							<p className="text-muted-foreground">Prompt not recorded</p>
						)}
					</div>
					<div className="p-4 space-y-3">
						<div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
							<span>
								{r.durationMs != null
									? `Worked for ${Math.floor(r.durationMs / 60000)}m ${Math.floor((r.durationMs % 60000) / 1000)}s${r.durationSource === "timestamps" ? " (from timestamps)" : ""}`
									: "Turn in progress"}
							</span>
							<CostPopover usage={r.usage} />
						</div>
						{r.response ? (
							<MarkdownContent content={r.response} />
						) : (
							<p className="text-muted-foreground">Waiting for the final response…</p>
						)}
						{r.usage.length > 0 && (
							<p className="text-xs text-muted-foreground">{costDrivers(r.usage)}</p>
						)}
						{r.files.length > 0 && (
							<details className="rounded-lg border border-border">
								<summary className="cursor-pointer p-3">
									Edited {r.files.length} files{" "}
									<span className="text-green-500">
										+{r.files.reduce((a, f) => a + f.added, 0)}
									</span>{" "}
									<span className="text-red-500">
										−{r.files.reduce((a, f) => a + f.removed, 0)}
									</span>
								</summary>
								<div className="divide-y divide-border">
									{r.files.map((f) => (
										<details key={f.path}>
											<summary className="cursor-pointer px-3 py-2 break-all text-sm">
												{f.path} <span className="text-green-500">+{f.added}</span>{" "}
												<span className="text-red-500">−{f.removed}</span>
											</summary>
											<pre className="overflow-x-auto max-h-[32rem] text-xs p-3 bg-background">
												{f.diff.split("\n").map((line, i) => (
													<div
														key={`${f.path}-${i}`}
														className={
															line.startsWith("+")
																? "text-green-400"
																: line.startsWith("-")
																	? "text-red-400"
																	: "text-muted-foreground"
														}
													>
														{line || " "}
													</div>
												))}
											</pre>
											{f.truncated && (
												<p className="p-3 text-xs text-amber-500">Diff truncated at 64 KiB.</p>
											)}
										</details>
									))}
								</div>
							</details>
						)}
					</div>
				</article>
			))}
			{count < turns.length && (
				<button
					type="button"
					className="rounded border border-border px-4 py-2 text-sm"
					onClick={() => setCount(count + 20)}
				>
					Show older turns ({turns.length - count} remaining)
				</button>
			)}
		</div>
	);
}

import { useEffect, useState } from "react";
import { costDrivers, costTotal } from "../../shared/model-pricing.js";
import type { CostOverviewData } from "../../shared/session-results.js";
import { api } from "../lib/api.js";
import { CostPopover, money } from "./CostPopover.js";
export function CostOverview() {
	const [data, setData] = useState<CostOverviewData | null>(null);
	const [error, setError] = useState("");
	const [mode, setMode] = useState<"sessions" | "tasks">("sessions");
	useEffect(() => {
		let alive = true;
		let busy = false;
		async function load() {
			if (busy) return;
			busy = true;
			try {
				const r = await api.getCostOverview();
				if (alive) {
					setData(r);
					setError("");
				}
			} catch {
				if (alive) setError("Cost overview could not be refreshed.");
			} finally {
				busy = false;
			}
		}
		void load();
		const timer = setInterval(load, 30000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, []);
	return (
		<details className="mb-6 rounded-xl border border-border bg-card" open>
			<summary className="p-4 cursor-pointer font-medium">
				Most expensive tasks ·{" "}
				{data
					? `${money(data.known)} estimated across ${data.turnCount.toLocaleString()} collected turns`
					: "Loading costs…"}
			</summary>
			<div className="px-4 pb-4 space-y-3">
				<p className="text-xs text-muted-foreground">
					Ranked by known API token cost. Whole sessions include all collected history.
					Individual-turn rankings cover the latest {data?.rankedTurns.toLocaleString() ?? "5,000"}{" "}
					turns.{" "}
					{data?.unknownTokens
						? `${data.unknownTokens.toLocaleString()} tokens have unknown prices and are excluded from the ranked cost.`
						: ""}
				</p>
				<div className="flex gap-2">
					<button
						type="button"
						aria-pressed={mode === "sessions"}
						onClick={() => setMode("sessions")}
						className="rounded border border-border px-3 py-1 text-xs"
					>
						Whole sessions
					</button>
					<button
						type="button"
						aria-pressed={mode === "tasks"}
						onClick={() => setMode("tasks")}
						className="rounded border border-border px-3 py-1 text-xs"
					>
						Individual turns
					</button>
				</div>
				{data?.unreportedTurns ? (
					<p className="text-xs text-muted-foreground">
						{data.unreportedTurns} collected turns have no reported token usage.
					</p>
				) : null}
				{error && (
					<p role="alert" className="text-amber-500 text-xs">
						{error}
					</p>
				)}
				{data?.[mode].map((t) => (
					<div key={`${t.sessionId}-${t.turnId}`} className="border-t border-border pt-3">
						<div className="flex flex-wrap justify-between gap-2">
							<a
								href={`/sessions/${encodeURIComponent(t.sessionId)}?tab=results${t.turnId ? `#turn-${encodeURIComponent(t.turnId)}` : ""}`}
								className="text-sm font-medium underline"
							>
								{t.prompt.slice(0, 180) || t.sessionName}
							</a>
							<CostPopover usage={t.usage} />
						</div>
						<p className="text-xs text-muted-foreground mt-1">
							{t.sessionName} · {t.host} · {t.toolCalls} reported tool calls ·{" "}
							{"Estimated cost: "}{money(costTotal(t.usage).known)} ·{" "}
							{costTotal(t.usage).complete ? "All reported usage priced" : `${costTotal(t.usage).unknownTokens.toLocaleString()} tokens unpriced`}
						</p>
						<p className="text-xs mt-1">{costDrivers(t.usage)}</p>
					</div>
				))}
				{data && !data[mode].length && (
					<p className="text-sm text-muted-foreground">
						No priced task usage has been collected yet.
					</p>
				)}
			</div>
		</details>
	);
}

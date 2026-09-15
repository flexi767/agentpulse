import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRICE_CHECKED_AT, costTotal, usageCost } from "../../shared/model-pricing.js";
import type { ModelUsage } from "../../shared/session-results.js";
export const money = (n: number) =>
	`$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
export function CostPopover({ usage, model }: { usage: ModelUsage[]; model?: string | null }) {
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const anchor = useRef<HTMLButtonElement>(null);
	const popup = useRef<HTMLDialogElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pinned = useRef(false);
	function show() {
		if (timer.current) clearTimeout(timer.current);
		const r = anchor.current?.getBoundingClientRect();
		if (r)
			setPosition({
				left: Math.max(
					8,
					Math.min(r.left, window.innerWidth - Math.min(512, window.innerWidth * 0.85) - 8),
				),
				top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 430)),
			});
		setOpen(true);
	}
	function leave() {
		if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 180);
	}
	const close = useCallback(() => {
		pinned.current = false;
		setOpen(false);
	}, []);
	useEffect(() => {
		if (!open) return;
		const outside = (e: PointerEvent) => {
			if (!anchor.current?.contains(e.target as Node) && !popup.current?.contains(e.target as Node))
				close();
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [open, close]);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const total = costTotal(usage);
	return (
		<div className="relative inline-block" onMouseEnter={show} onMouseLeave={leave}>
			<button
				ref={anchor}
				type="button"
				aria-expanded={open}
				onClick={(e) => {
					e.stopPropagation();
					if (pinned.current) {
						close();
					} else {
						pinned.current = true;
						show();
					}
				}}
				onFocus={show}
				onKeyDown={(e) => {
					if (e.key === "Escape") close();
				}}
				className="text-left text-xs text-foreground underline decoration-dotted underline-offset-4"
			>
				{model ||
					(usage.length
						? [...new Set(usage.map((u) => u.model))].join(" + ")
						: "Unknown model")}{" "}
				·{" "}
				{usage.length
					? `${money(total.known)}${total.complete ? "" : " + unpriced"} est.`
					: "Cost not reported"}
			</button>
			{open &&
				createPortal(
					<dialog
						open
						ref={popup}
						style={position}
						onMouseEnter={show}
						onMouseLeave={leave}
						aria-label="Token prices and estimated cost"
						className="fixed m-0 z-50 w-[min(32rem,85vw)] max-h-[65vh] overflow-auto rounded-lg border border-border bg-card text-card-foreground p-4 shadow-xl text-xs"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") close();
						}}
					>
						<div className="flex justify-between gap-4">
							<strong>
								Estimated API cost: {money(total.known)}
								{!total.complete && " + unpriced usage"}
							</strong>
							<button type="button" onClick={close} aria-label="Close cost details">
								×
							</button>
						</div>
						{usage.map((u, i) => {
							const c = usageCost(u);
							return (
								<section key={`${u.model}-${i}`} className="mt-3 border-t border-border pt-3">
									<strong>
										{u.model}
										{u.longContext ? " · long context" : ""}
										{u.fast ? " · fast" : ""}
									</strong>
									<table className="w-full mt-2 text-right">
										<thead>
											<tr>
												<th className="text-left">Category</th>
												<th>Tokens</th>
												<th>$/1M</th>
												<th>Cost</th>
											</tr>
										</thead>
										<tbody>
											{[
												"Uncached input",
												"Cached input / reads",
												"Cache writes (5m)",
												"Cache writes (1h)",
												"Output",
											].map((name, j) => (
												<tr key={name}>
													<td className="text-left py-1">{name}</td>
													<td>{c.tokens[j].toLocaleString()}</td>
													<td>{c.rates ? money(c.rates[j]) : "Unknown"}</td>
													<td>{c.charges ? money(c.charges[j]) : "Unknown"}</td>
												</tr>
											))}
										</tbody>
									</table>
									<p className="mt-2">
										Reasoning:{" "}
										{u.model.startsWith("claude-")
											? "not separately reported"
											: `${u.reasoningTokens.toLocaleString()} tokens, included in output`}
										. Cached output: not reported by the provider.
									</p>
									{c.price && (
										<a className="underline" href={c.price.source} target="_blank" rel="noreferrer">
											Provider price source
										</a>
									)}
								</section>
							);
						})}
						<p className="mt-3 text-muted-foreground">
							USD token estimate at published API rates checked {PRICE_CHECKED_AT}. This is not a
							subscription bill. Historical price changes, regional uplifts, discounts and tool
							charges are excluded. Unreported speed uses standard rates; unreported cache TTL uses
							the 5-minute rate. Unknown models are unpriced.
						</p>
					</dialog>,
					document.body,
				)}
		</div>
	);
}

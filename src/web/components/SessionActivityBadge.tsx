import { useEffect, useState } from "react";

export function SessionActivityBadge({
	working,
	waiting = false,
}: { working: boolean; waiting?: boolean }) {
	const [showWorking, setShowWorking] = useState(working);
	useEffect(() => {
		if (working) {
			setShowWorking(true);
			return;
		}
		// Tool boundaries can briefly report idle during a continuing turn.
		const timer = setTimeout(() => setShowWorking(false), 1000);
		return () => clearTimeout(timer);
	}, [working]);
	const label = waiting ? "Waiting" : working || showWorking ? "Working" : "Idle";
	return (
		<span className="inline-flex w-[4.5rem] shrink-0 items-center justify-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
			{label}
		</span>
	);
}

import { useEffect } from "react";
import type { DashboardStats, Session } from "../../shared/types.js";
import { api } from "../lib/api.js";
import { useSessionStore } from "../stores/session-store.js";

export function useSessions() {
	const { sessions, stats, setSessions, setStats, isLoading, setLoading } = useSessionStore();

	useEffect(() => {
		let cancelled = false;
		let fetching = false;
		async function fetchSessions() {
			if (fetching) return;
			fetching = true;
			try {
				const [sessionsRes, statsRes] = await Promise.all([
					api.getSessions({ limit: 100 }),
					api.getStats(),
				]);
				if (cancelled) return;
				setSessions(sessionsRes.sessions as Session[]);
				setStats(statsRes as DashboardStats);
			} catch (err) {
				console.error("[sessions] Failed to fetch:", err);
			} finally {
				fetching = false;
				if (!cancelled) setLoading(false);
			}
		}

		fetchSessions();

		// Refresh every 30 seconds as a fallback
		const interval = setInterval(fetchSessions, 30_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [setSessions, setStats, setLoading]);

	return { sessions, stats, isLoading };
}

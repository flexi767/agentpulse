import type { Session } from "../../shared/types.js";

export function sessionHost(session: Session): string {
	const host = session.metadata?.hostName ?? session.managedSession?.hostName;
	return typeof host === "string" && host.trim() ? host.trim() : "Unknown host";
}

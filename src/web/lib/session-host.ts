import type { ManagedSession, Session } from "../../shared/types.js";

export function sessionHost(
	session: Pick<Session, "metadata"> & { managedSession?: Pick<ManagedSession, "hostName"> | null },
): string {
	const host = session.metadata?.hostName ?? session.managedSession?.hostName;
	return typeof host === "string" && host.trim() ? host.trim() : "Unknown host";
}

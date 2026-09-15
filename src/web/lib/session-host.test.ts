import { expect, test } from "bun:test";
import type { Session } from "../../shared/types.js";
import { sessionHost } from "./session-host.js";

test("observed host takes precedence over managed host", () => {
	expect(sessionHost({ metadata: { hostName: " worker-a " }, managedSession: { hostName: "worker-b" } } as Session)).toBe("worker-a");
});

test("managed sessions can supply their host", () => {
	expect(sessionHost({ metadata: {}, managedSession: { hostName: "worker-b" } } as Session)).toBe("worker-b");
});

test("missing host is explicit rather than inferred from a shared cwd", () => {
	expect(sessionHost({ metadata: {}, cwd: "/workspace/project" } as Session)).toBe("Unknown host");
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { setup } from "./setup.js";

describe("generated Codex setup", () => {
	for (const route of ["/setup.sh", "/setup-relay.sh"]) {
		test(`${route} embeds the preserving command-hook installer`, async () => {
			const response = await setup.request(route);
			expect(response.status).toBe(200);
			const script = await response.text();
			const helper = readFileSync("scripts/install-codex-hooks.py", "utf8");
			expect(script).toContain(`<<'AGENTPULSE_CODEX_SETUP'\n${helper}AGENTPULSE_CODEX_SETUP`);
			expect(script).not.toContain('CODEX_HOOKS="["');
		});
	}

	test("standalone helper is served for downloaded setup scripts", async () => {
		const response = await setup.request("/install-codex-hooks.py");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(readFileSync("scripts/install-codex-hooks.py", "utf8"));
	});
});

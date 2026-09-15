import { startCodexObserver } from "../src/supervisor/services/codex-observer";

await startCodexObserver({ serverUrl: process.env.AGENTPULSE_SERVER_URL ?? "http://127.0.0.1:4000", apiKey: null });
setInterval(() => {}, 60_000);

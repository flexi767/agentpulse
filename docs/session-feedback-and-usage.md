# Session feedback and usage

The dashboard shows each session's model, cumulative token usage and latest request context. Overview includes input/output, cache read/write, and separately reported reasoning. Codex reports the context-window limit; Claude transcripts do not supply a reliable limit, so the dashboard shows it as unknown. Context is a snapshot of the last model request, not a continuously counted estimate. Token counts are not monetary charges.

Codex's observer forwards `turn_context` models and `token_count` usage to the ingest-scoped `/api/v1/telemetry` endpoint. The host-side Python hook also reads transcripts incrementally, including Claude assistant usage. Claude request IDs deduplicate repeated streaming chunks. Reads are bounded to 8 MiB per hook, incomplete records wait for a newline, and per-file cursors are persisted under `~/.agentpulse/usage-state/`. Historical reports cannot replace newer telemetry. The backfill helper refreshes existing sessions without replaying hooks or creating agent turns.

Open a session workspace and use **Send feedback → Queue feedback**. The message remains queued until that session runs a tool or submits another prompt. The host hook claims one message, emits `hookSpecificOutput.additionalContext`, and acknowledges it. **Delivered to hook** means that the helper emitted the context; it does not prove the model acted on it. Idle sessions are not woken by feedback. Supported existing agent hooks must be enabled; older sessions that have not loaded hooks may need to resume first. Direct managed-session prompt controls remain available for immediate turns.

Feedback is stored durably in session metadata. A claim leases a message for 60 seconds; failed delivery without acknowledgement becomes eligible for retry. Delivery is at least once: a lost acknowledgement can cause the same feedback ID to appear again. Claim and acknowledgement require ingest authentication and the matching session host; queueing requires dashboard manage permission. Optimistic metadata updates preserve concurrent feedback, telemetry and host changes.

Install `scripts/session-hook.py` alongside existing AgentPulse hooks with:

```sh
python3 scripts/install-session-hook.py --local-url http://127.0.0.1:PORT/api/v1
```

Choose the local relay API for remote hosts or the local server API on the server host. The installer preserves unrelated hooks and saves exact timestamped backups before changing AgentPulse wrappers or settings. To undo the integration, restore the matching `.before-feedback-TIMESTAMP` backups of the wrapper and agent settings. No additional persistent process is created.

Verification commands:

```sh
python3 scripts/session-hook-test.py
bun test src/server/services/session-feedback.test.ts src/shared/session-telemetry.test.ts
bun run typecheck
bun run build
```

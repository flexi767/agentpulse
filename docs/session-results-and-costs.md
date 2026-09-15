# Turn results and cost estimates

Session workspaces open on Results. The host collector imports prompts, final responses, durations and recorded file-change diffs into durable `agentpulse_turn_result` events. Result events are excluded from the ordinary activity timeline. Codex native `task_started`/`task_complete` and `FileChange` items preserve provider duration and agent attribution without diffing a shared checkout. Claude confirmed Edit/Write tool results supply recorded edit hunks; shell writes with no recorded file-change data are not inferred. Per-file edit hunks are cumulative recorded changes, not a reconstructed Git baseline. Diffs are bounded to 64 KiB per file and explicitly marked when truncated.

Codex response-level `token_usage_record` data deduplicates response IDs, supplies turn and thread usage and takes precedence over older token-count snapshots. Older Codex formats fall back to cumulative usage deltas. Claude request IDs deduplicate streaming usage by taking maximum counts. Each request retains its observed model, speed and context size. Five-minute and one-hour cache-write counts are separated when supplied. Output includes reasoning; reasoning is never billed a second time. Cached output is not a provider-reported token category.

Model/cost buttons open details on hover, focus or click. Click pins the popup; Escape, the close button or clicking outside closes it. The table shows uncached input, cache reads, 5-minute writes, 1-hour writes and output, their token counts, USD rates per million and estimated charges. Session totals sum the collected turns across model changes. Unknown models and unsupported pricing modes remain unpriced. The dashboard ranks whole sessions and individual turns by known cost and explains the largest charge category, request count, largest context and cache-hit percentage. Whole-session totals include all collected history; individual-turn rankings cover the latest 5,000 turns. Missing/unpriced coverage is shown.

Published API rates checked 2026-09-15:

- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/gpt-5.5
- https://platform.claude.com/docs/en/about-claude/pricing

These are current-rate token estimates, not actual Codex/Claude subscription invoices. Historical prices, regional charges, discounts and server-side tool charges are excluded. Unreported speed defaults to standard and unreported Claude cache-write TTL defaults to 5 minutes. OpenAI requests above 272k input tokens use the listed long-context rates. Supported Claude 4.6+ models use standard pricing across their full context window. Provider-specific session-wide pricing rules or negotiated billing may differ from these request-based estimates.

The collector adds no persistent process. Existing hooks and the existing Codex observer refresh results. Pending revisions survive failed delivery, and acknowledgement only clears the exact delivered revision. Backfill refreshes usage and imports results without replaying hooks or starting an agent turn. Result ingestion requires an ingest key plus the matching recorded host. Result reading and cost overview require operator/manage access because prompts and diffs can contain arbitrary private text. Result events inherit the existing event-to-session cascade deletion policy.

Validation: Python usage/result parser tests; Bun cost and result storage tests; TypeScript checks; production build; browser result, file-diff and cost-popup checks.

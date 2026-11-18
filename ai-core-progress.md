# AI core upgrade progress

Worker: AI-CORE-2, branch `ai-core-v2`. One item per loop round, proved before it is ticked. Standards, ground rules and ownership are in the founder's loop prompt; `PROBLEM.md` wins on any conflict.

## Checklist

- [ ] Audit and baseline: compare the current core against every standard above, as a table (standard, current state, planned change, file). Then run agent:run on my frozen task file at k=3 and record the baseline: pass^k from my graders, cost per completed task, cache hit ratio, p50 and p95 turn latency, tokens per turn. Stop and wait for my OK on the plan.
- [ ] Request shape and caching: stable prefix, breakpoints, sorted tools, volatile context after the prefix; cache hits recorded and non-zero after turn one.
- [ ] Tools: strict schemas, descriptions, tool context instead of model-filled ids, stale-write check, parallel-safe reads, truncation, image results, input validation and repair.
- [ ] Loop control and budgets: stop conditions, per-turn budget and caps, every stop reason handled.
- [ ] Context: append-only history verified, provider context editing and compaction on, model registry in place.
- [ ] Reasoning and effort: adaptive thinking, effort per route, summarized display wired to the thinking component.
- [ ] Approvals and policy: toolApproval-based policy, protected paths, no-retry instruction, decisions recorded.
- [ ] Errors and providers: typed error chain, retry rules, separate rate budgets, Anthropic and OpenAI adapters, the same task passing on both.
- [ ] Turn record v2 and config hash.
- [ ] Settings panel: sidebar entry, four tabs, server-side clamping, persistence.
- [ ] Re-measure: the same agent:run at k=3 on the same frozen tasks, per provider. Put the before/after table in the progress file. Any drop in pass^k or rise in cost per completed task is a blocker to explain or fix, not to hide.

## Folded-in orchestrator items

- Errors item: `/api/chat` calls `sandboxMessage(error)` in its `openProject` catch.
- Loop control item: the UI treats `TurnStatus` `'unverified'` as not a pass.
- Settings item: the settings schema lives in one exported module the DB worker (branch `db`, Supabase + Drizzle, `user_settings`) can import; localStorage until then.

## Questions for the founder

None yet.

## Round log

- Round 1 (2026-11-18): merged `betterlook` (fast-forward to `60528b79`, includes S01). Created this file. Stopped as the loop prompt says.

# DB progress

- [x] Study and plan. Review the current Betterlook contracts and the Onlook v1 schema and authorization fix. Record the proposed schema, route access and pending mappings, and confirm sign-in, project ownership and deployment with the founder.
- [x] Supabase Cloud and Drizzle. Set up the Drizzle client, configuration and first migration. Apply the approved migration to the cloud dev project and verify RLS on every product table.
- [ ] Auth. Verify sign-in, sign-out, middleware session refresh, and first-sign-in profile creation. Require auth in `/api/chat` and every data route. Ask designers to sign in before the first send.
- [ ] Access helpers. Resolve and verify ownership for projects, conversations, messages, turns, events, sandboxes, and settings. Use the helpers in every data route and return one shared error for missing and unauthorized resources.
- [ ] Projects and conversations. Create the project, conversation, and sandbox ID on first send. Restore chat with thinking and reasoning parts intact and reconnect the sandbox after reload or on another browser. Remove the matching localStorage state.
- [ ] Turns, events and settings. Write turn record v2 product fields to `turns` and log restore, keep, approve, and deny with their reasons in `events`. Persist and clamp Settings on the server. Verify settings changes affect the next turn's config hash and Context & cost totals come from `turns`.
- [ ] Authorization test. Add a member and outsider test and a two-user script. Verify user B receives the same error on every route for every resource owned by user A, including sandbox IDs and settings.
- [ ] Consent. Store consent in `user_settings` and verify that an exported Langfuse trace contains only metadata when consent is off.
- [ ] Runner isolation. Run `agent:run` without signing in. Verify it uses defaults and writes nothing to user tables.
- [ ] Failure states. Verify readable errors or safe fallbacks for database downtime, expired sessions, invalid settings, and failed turn writes. Log failed writes and keep chat working.

## Study and plan

Baseline is `betterlook` at `8ceb7805`. The agent exposes the original `TurnRecord`, `TurnEvent`, and `AgentMessage` types, and `runAgent()` returns both the UI stream and a turn promise. Agent limits and tool policy are static. No Settings schema or localStorage-backed Settings panel is present on this ref. The workspace stores chat and sandbox ID in localStorage. Sources: `apps/web/src/lib/agent/types.ts`, `config.ts`, `run.ts`, `policy.ts`, and `apps/web/src/workspace/Workspace.tsx`.

### Onlook v1

- Keep the Supabase-managed `auth.users` reference, the matching public profile with cascading delete, and the project → conversation → message hierarchy with typed JSONB message parts. Use Supabase SSR cookies and Next's session-refresh proxy, with `auth.getUser()` in server handlers. Use server-only Drizzle over postgres-js with `prepare: false` and a development-cached connection. Use drizzle-kit with Supabase roles, public-schema migrations under `supabase/migrations`, and RLS on every product table. Sources: `upstream/v1:packages/db/src/schema/`, `packages/db/src/client.ts`, `packages/db/drizzle.config.ts`, `apps/web/client/src/proxy.ts`, `apps/web/client/src/utils/supabase/`, and `apps/web/client/src/server/api/trpc.ts`.
- Use an owner ID on each project for the MVP. Keep the existing Next route handlers. Omit upstream tRPC, browser data and storage access, branches, canvas, frames, domains, subscriptions, invitations, and extra project and message fields. Sources: `upstream/v1:packages/db/src/schema/user/user-project.ts`, `project/project.ts`, `chat/conversation.ts`, `chat/message.ts`, and `apps/web/client/src/utils/supabase/client/index.ts`.
- Onlook's Drizzle connection bypassed RLS. A signed-in user was sufficient for routes that skipped membership checks, exposing other users' resources. The fix applied resolve-then-verify checks, scoped provider sandbox listings and pinned self-service writes to the session. Its sandbox guard still allowed IDs without a project for bootstrap. Betterlook provisions a sandbox server-side for an owned project and records the association before accepting reconnect or restore requests. A supplied sandbox ID without an owned project gets the shared resource error. Source: `git show 423e2e92`.

### Proposed schema and routes

`id` is the primary key unless stated otherwise. All timestamps use `timestamptz`. Foreign keys follow the ownership chain and cascade on deletion. `auth.users` is a reference managed by Supabase. Route names marked new are proposed.

| Table | Columns | Route reads and writes |
| --- | --- | --- |
| `users` | `id uuid` (PK and FK to `auth.users.id`), `created_at` | The Supabase sign-in callback verifies the user and inserts the profile idempotently. |
| `user_settings` — pending turn record v2 / settings schema | `user_id uuid` (PK and FK to `users`), `settings jsonb` | New `GET /api/settings` reads the session user's row. New `PUT /api/settings` validates, clamps, and upserts it. `POST /api/chat` reads it for effective agent settings and trace consent. |
| `projects` | `id uuid`, `owner_id uuid` (FK to `users`), `name text`, `sandbox_id text` (unique and nullable during provisioning), `created_at`, `updated_at` | `POST /api/chat` creates the project on first send and records the provisioned sandbox. New `GET /api/projects` lists the caller's projects and their conversations. `POST /api/sandbox` reconnects the project's sandbox. `POST /api/restore` uses the sandbox resolved from the turn. |
| `conversations` | `id uuid`, `project_id uuid` (FK to `projects`), `created_at`, `updated_at` | `POST /api/chat` creates the first conversation and updates its timestamp on new activity. `GET /api/projects` lists owned conversations. New `GET /api/conversations/[id]` reads the owned conversation, history, and usage totals. |
| `messages` | `id bigint` (internal identity), `conversation_id uuid` (FK to `conversations`), `ui_id text` (AI SDK `UIMessage.id`, unique within the conversation), `role`, `parts jsonb`, `metadata jsonb`, `usage jsonb` (nullable), `created_at`. The final `parts`, `metadata`, and `usage` mappings are pending turn record v2 / settings schema. | `POST /api/chat` loads stored history, appends validated user input and the server-produced assistant message, and resolves approval responses by `ui_id` within the owned conversation. `POST /api/restore` resolves the assistant message by the same key. `GET /api/conversations/[id]` reads messages in append order and uses `ui_id` as `UIMessage.id`. |
| `turns` — pending turn record v2 / settings schema | `id uuid` (agent turn ID), `message_id bigint` (FK to the assistant `messages` row), `trace_id text`, `checkpoint_id text` (nullable), `status text`, `stop_reason text` (nullable), `provider text`, `model text`, `config_hash text`, `input_tokens bigint`, `output_tokens bigint`, `cache_read_tokens bigint`, `cache_write_tokens bigint`, `cost_usd numeric` (nullable), `created_at` | `POST /api/chat` writes a product summary when the agent turn settles. `GET /api/conversations/[id]` reads turn data for history and aggregates that conversation's totals for Context & cost. `POST /api/restore` and `POST /api/events` resolve the owned turn. |
| `events` — pending turn record v2 / settings schema | `id bigint` (identity), `turn_id uuid` (required FK to `turns`), `type` (`restore`, `keep`, `approve`, `deny`), `reason text`, `tool_call_id text` (nullable), `created_at` | `POST /api/restore` records a successful restore. `POST /api/events` appends keep. `POST /api/chat` records approve or deny against the turn that requested approval. `GET /api/conversations/[id]` reads action state for restored history. |

### Contract differences and pending mappings

- **`user_settings.settings` — pending turn record v2 / settings schema.** The shared server schema supplies the JSONB type, clamps and defaults for models and effort per route, thinking display, step cap, per-turn budget and cost cap, tool toggles, protected paths, approval mode, context editing and compaction, and trace consent. Parse and clamp on both reads and writes, with safe defaults for missing or invalid rows. Use the resolved settings for each turn so a saved change is reflected in the next effective config hash. Source: current `lib/agent/config.ts` and `lib/agent/run.ts` under `apps/web/src`.
- **`messages.parts`, `messages.metadata`, `messages.usage` — pending turn record v2 / settings schema.** Persist server-produced AI SDK parts, including unchanged thinking and reasoning, with no client-supplied assistant history. The proposed extra `metadata` column carries the selected model and server-generated UI notice, which the current renderer uses. Rehydrate turn ID, trace ID and status from the linked turn. Append approval events and continuations and preserve the original message rows. Sources: `lib/agent/types.ts`, `lib/agent/client.ts`, `lib/agent/run.ts`, and `components/ai/Message.tsx` under `apps/web/src`.
- **`turns` — pending turn record v2 / settings schema.** Confirm turn and message linkage, trace and checkpoint IDs, status and stop reason, provider and model, effective config hash, each token counter, cost, and the creation timestamp. The baseline has separate system prompt and tool config hashes, `stepLimitReached` and optional error text, nested nullable `checkpoint.id`, and `startedAt` and `endedAt`. Usage has input, output and `cachedInputTokens`, plus nullable `costUsd` initialized to `null`. It collects cache reads and exposes no cache-write total or explicit stop reason. Use the final record for these mappings. Sources: `lib/agent/types.ts` and `lib/agent/run.ts` under `apps/web/src`.
- **`events` — pending turn record v2 / settings schema.** Confirm the turn link, event types, reason, tool-call correlation and timestamp. The baseline has `at`, optional `traceId`, a `checkpointId` for restore, and `toolCallId` for approve and deny. There is no event `reason`, and approvals are currently logged at continuation. The proposed `tool_call_id` preserves which request was answered when a turn has multiple tool calls. Resolve trace and checkpoint IDs from the owned turn. Sources: `lib/agent/types.ts`, `lib/agent/events.ts`, and `lib/agent/run.ts` under `apps/web/src`.

### Access and persistence

- `requireUser` verifies the Supabase user for data routes. `requireProject` scopes by `projects.owner_id`. `requireConversation`, `requireMessage`, `requireTurn`, and `requireEvent` follow the stored parent chain to that project. `requireSandbox` maps the sandbox ID to that same owned project. `requireSettings` scopes by the authenticated user ID. Project lists and settings writes derive the owner from the session. Signed-in requests for missing or foreign resources get the same `404` and `Unauthorized or not found` body. A request with multiple IDs must resolve them to the same resource chain before any tool, provider, checkpoint, trace or write operation. Enable RLS on each product table as defense in depth and keep the browser on Supabase Auth only.
- `/api/chat` currently takes browser-supplied history and sandbox ID. When persistence routes land, load the owned conversation's saved history and project sandbox. Use `(conversation_id, ui_id)` to resolve the stored assistant message for an approval, then verify the approval ID against its pending tool call. Restore uses the same conversation-scoped lookup to find the assistant message, then derives the checkpoint, sandbox and trace IDs from its turn. `/api/events` derives the trace ID from the owned turn. Reconnect failures surface as errors so an existing conversation keeps its sandbox association. `/workspace/preview` is a static placeholder. The existing ChatGPT model-credential endpoints carry no product database state. Sources: `app/api/chat/route.ts`, `app/api/restore/route.ts`, `app/api/events/route.ts`, `app/api/sandbox/route.ts`, and `app/workspace/preview/route.ts` under `apps/web/src`.
- Store product state and the trace ID in Postgres. Keep provider credentials on their current path. `runAgent()` uses the server-resolved consent value. Consent on sends the redacted full turn record to Langfuse. Consent off exports only trace ID, model, config hash, status, tokens and timing, including for nested spans and events. The CLI calls the agent with defaults and no database writes or session dependency. Replace workspace localStorage with server reads and writes, with no import. Log turn-write failures with a safe diagnostic and allow the chat stream to complete. Sources: `lib/agent/run.ts`, `lib/agent/trace.ts`, `lib/agent/events.ts`, and `workspace/Workspace.tsx` under `apps/web/src`, and `apps/web/scripts/agent-run.ts`.

### Founder decisions

1. Use GitHub OAuth plus email magic link. Use Supabase's built-in email service for now.
2. Store `owner_id` on each project. A membership table waits for sharing.
3. Use the founder's Supabase Cloud dev project. Production on Vercel waits for the founder's go-ahead before receiving database or sandbox credentials.

### Evidence

Both runs used separate clean exports of `8ceb7805`, a frozen Bun install, and no local environment files. A bare typecheck on a fresh export could not resolve the SVG import. Generating Next's declarations with `next typegen` in `apps/web` fixed the clean-run setup.

| Check | Run 1 | Run 2 |
| --- | --- | --- |
| `bun run typecheck` | Passed | Passed |
| `bun run test` | 71 passed, 0 failed | 71 passed, 0 failed |

Live `agent:run`, migration, authorization, UI, trace and secret-scan evidence is pending the implementation rounds. This phase used no credentials and produced no screenshots, exported traces or database dump.

## Supabase Cloud and Drizzle

`git merge betterlook` fast-forwarded `db` to `a106f753`. The branch includes `.env.example` and the merged agent updates. `turns` and `user_settings` await the final turn record v2 and Settings schema. The next migration creates `events` alongside `turns` with a required foreign key so every event resolves to an owned project.

- The app uses `DATABASE_URL` for the transaction pooler on port 6543. The server-only Drizzle client uses postgres-js with `prepare: false` and a development cache. `bun run db:migrate` loads `apps/web/.env` for drizzle-kit and uses `DIRECT_URL` for the session pooler on port 5432. Both use `verifiedDatabaseUrl()` to set `sslmode=verify-full` and point the driver at `apps/web/supabase-ca.crt`.
- The browser Supabase variables are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY` is read only by `apps/web/src/lib/supabase/server-env.ts`, which uses Next.js's built-in `server-only` import guard. [Next.js server and client component docs](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)
- `drizzle-orm` provides the schema and queries, `postgres` provides the driver, and `drizzle-kit` generates and applies migrations. Supabase manages `auth.users`, which the schema references through Drizzle's existing declaration. [Drizzle Supabase RLS docs](https://orm.drizzle.team/docs/rls#using-with-supabase)

### Applied migration

One migration, [`0000_product_tables.sql`](supabase/migrations/0000_product_tables.sql), creates the following objects in `public`. Columns are required unless marked nullable. `created_at` and `updated_at` use `timestamptz` and default to `now()`.

| Table | Columns and constraints |
| --- | --- |
| `users` | `id uuid` PK and FK to `auth.users.id` with cascade delete, `created_at` |
| `projects` | `id uuid` PK with generated UUID default, `owner_id uuid` FK to `users.id` with cascade delete, `name text`, `sandbox_id text` nullable and unique, `created_at`, `updated_at` |
| `conversations` | `id uuid` PK with generated UUID default, `project_id uuid` FK to `projects.id` with cascade delete, `created_at`, `updated_at` |
| `messages` | `id bigint` identity PK, `conversation_id uuid` FK to `conversations.id` with cascade delete, `ui_id text` unique with `conversation_id`, `role message_role`, `parts jsonb`, `metadata jsonb` nullable, `usage jsonb` nullable, `created_at` |

The migration adds `message_role` (`user`, `assistant`, `system`), the messages identity sequence, and indexes on `projects(owner_id)`, `conversations(project_id)`, and `messages(conversation_id, id)`. Drizzle records the application in `drizzle.__drizzle_migrations`.

```sql
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
```

The migration adds no RLS policies, so ordinary Supabase API roles have no product table access. The app server remains responsible for owner checks on its Drizzle connection.

The founder approved this first migration with the two schema changes above. Later migrations that only add can run under that approval. Changes to existing objects or drops require a separate approval.

### Pre-migration verification

Both clean runs used a frozen install and no environment files or credentials. Next route types were generated before typecheck.

| Check | Run 1 | Run 2 |
| --- | --- | --- |
| `bun run typecheck` | Passed | Passed |
| `bun run test` | 85 passed, 0 failed | 85 passed, 0 failed |
| `drizzle-kit check` and `drizzle-kit generate` | Valid migration history and no schema changes | Valid migration history and no schema changes |
| `bun run build` in `apps/web` | Passed, server trace contains the CA | Passed, server trace contains the CA |
| Next build with a temporary Client Component importing the secret module | Rejected the `server-only` import | Rejected the `server-only` import |

### Cloud TLS and deployment

The `DIRECT_URL` preflight failed with `SELF_SIGNED_CERT_IN_CHAIN`. A strict OpenSSL PostgreSQL TLS handshake sent no database credentials and showed `O=Supabase Inc` on the chain. The leaf issuer is `Supabase Intermediate 2021 CA`. The intermediate issuer is `Supabase Root 2021 CA`, and the self-signed root reported at depth 2 has the same name. The presented chain identifies Supabase's CA and shows no local interception issuer.

The founder supplied the public project CA from Supabase Database Settings. With that CA, a preflight verified the certificate chain and hostname for both `DIRECT_URL` and `DATABASE_URL`. Both connections reported zero public base tables before migration. Keep `verify-full` on both connections. [Supabase SSL enforcement docs](https://supabase.com/docs/guides/platform/ssl-enforcement)

Production uses the same tracked `apps/web/supabase-ca.crt` when the founder authorizes database access. Use `apps/web` as the Next.js project root. Next's `outputFileTracingIncludes` adds `supabase-ca.crt` to the server bundle, and the database driver loads it from the app root at runtime. Both clean builds list the file in `.next/server/app/api/chat/route.js.nft.json`. Production database and sandbox credentials still await the founder's go-ahead.

### Cloud verification

`bun run db:migrate` exited 0. Two independent audits returned the same output. The ledger hash matches the checked-in `0000` SQL. Column details come from `information_schema.columns`. RLS, policy counts, role privileges and the unique constraint come from `pg_catalog`. Each REST request used `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` without a user session and requested at most one ID.

```text
drizzle.__drizzle_migrations | entries=1 | 0000 hash matches=1
conversations | id uuid NOT NULL, project_id uuid NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL | relrowsecurity=true | policies=0 | anon_bypasses_rls=false
messages | id bigint NOT NULL, conversation_id uuid NOT NULL, ui_id text NOT NULL, role message_role NOT NULL, parts jsonb NOT NULL, metadata jsonb NULL, usage jsonb NULL, created_at timestamp with time zone NOT NULL | relrowsecurity=true | policies=0 | anon_bypasses_rls=false
projects | id uuid NOT NULL, owner_id uuid NOT NULL, name text NOT NULL, sandbox_id text NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL | relrowsecurity=true | policies=0 | anon_bypasses_rls=false
users | id uuid NOT NULL, created_at timestamp with time zone NOT NULL | relrowsecurity=true | policies=0 | anon_bypasses_rls=false
messages | UNIQUE (conversation_id, ui_id)
conversations | REST HTTP 200 | []
messages | REST HTTP 200 | []
projects | REST HTTP 200 | []
users | REST HTTP 200 | []
```

### Cloud verification with sentinel rows (DB-2b)

Two independent runs used fresh sentinel IDs. The Supabase Admin API created a throwaway `auth.users` row for each run. The server connection committed one transaction inserting a linked row in each product table. Each publishable-key REST request filtered for its exact sentinel, and the server checked that every row was visible both before and after the REST requests. The `anon` role had `SELECT` grants on all four tables. Each run deleted the product rows in one transaction, deleted the throwaway Auth user through the Admin API, and confirmed that all five sentinel records were gone.

Both runs returned this output.

```text
anon has SELECT grants on all four tables.
Admin user creation | HTTP 200 | auth.users match=1
Sentinel insert | committed one transaction
users | server count=1 | publishable REST HTTP 200 | []
projects | server count=1 | publishable REST HTTP 200 | []
conversations | server count=1 | publishable REST HTTP 200 | []
messages | server count=1 | publishable REST HTTP 200 | []
Server still sees one sentinel per table after all REST requests.
Sentinel delete | committed one transaction
Admin user delete | HTTP 200
Cleanup verified | users=0 | projects=0 | conversations=0 | messages=0 | auth.users=0
```

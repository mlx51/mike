# PR #777 evidence: find_documents failures as one typed AppError

Recorded 2026-11-05 with vhs (zsh, terminal only, 1700x620), converted to GIF at 8 fps with a 64-colour palette, played at 1.0x.
The backend ran from source (`node --import tsx src/index.ts`, `WORKERS_MODE=none`, `DB_JOBS_ENABLED=false`) from two detached worktrees against the shared local Supabase. **No database state was changed**: the faults came from a PostgREST pass-through proxy that only my backend used (its `SUPABASE_URL`). The model was a local Anthropic stub that answers with a `find_documents` tool_use. The sink was `scripts/sentry-sink.mjs`.

- `pr777-before.gif`: origin/main b91d1bdf4. 19.6 s, 239 KB.
- `pr777-after.gif`: PR head 627428cf6. 15.4 s, 216 KB.
- Raw URLs: https://raw.githubusercontent.com/mlx51/mike/assets/pr777-demo-2026-11-05/pr777/pr777-before.gif and https://raw.githubusercontent.com/mlx51/mike/assets/pr777-demo-2026-11-05/pr777/pr777-after.gif

## Setup

```bash
git worktree add --detach ~/dev/mike-wt/gif777-main b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif777-pr   627428cf6
# root + backend node_modules cloned with cp -cR (identical lockfiles): main <- mike-wt/feature-flags, PR <- mike-wt/algo
# backend/.env in both = ~/dev/mike/backend/.env minus PORT/FRONTEND_URL/NODE_ENV/SENTRY_*/WORKERS_MODE/DB_JOBS_*/SUPABASE_URL
#   and every provider key (*_API_KEY, ANTHROPIC_*, GEMINI*, OPENAI*, RESEND*, COURTLISTENER*), plus:
#   PORT=4777 FRONTEND_URL=http://127.0.0.1:3777 NODE_ENV=development SENTRY_DISABLED=false
#   SENTRY_DSN=http://mike@127.0.0.1:9777/1 WORKERS_MODE=none DB_JOBS_ENABLED=false
#   SUPABASE_URL=http://127.0.0.1:54777            # the fault proxy, not the gateway
#   ANTHROPIC_API_KEY=sk-ant-stub-deployment-DEPLOY ANTHROPIC_BASE_URL=http://127.0.0.1:4177/v1
PORT=54777 node fault-proxy.mjs   > proxy.log   # pipes everything to :54321
PORT=4177  node provider-stub.mjs > stub.log
PORT=9777  node ~/dev/mike/scripts/sentry-sink.mjs > sink.log
# safety net on each API: NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs" SINK_PORT=9777
#   (no [redirect] line in any API log: every event came from the explicit sink DSN)
vhs before.tape   # sources setup-main.sh -> helpers.sh
vhs after.tape    # sources setup-pr.sh   -> helpers.sh
ffmpeg -i pr777-<side>.mp4 -vf "fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr777-<side>.gif
```

- **`fault-proxy.mjs`**: every request is piped unchanged to `127.0.0.1:54321`, except `POST /rest/v1/rpc/find_document_text` (the RPC `findDocumentText` calls in `backend/src/modules/documents/documents.textSearch.ts:39`) while a mode is set. `POST /__fault/<mode>` switches it:
  - `PGRST202`: 404 `{"code":"PGRST202","details":"Searched for the function public.find_document_text with parameters … but no matches were found in the schema cache.","hint":"Perhaps you meant to call the function public.find_document_text_off","message":"Could not find the function public.find_document_text(…) in the schema cache"}`, the body the comment's rename recipe produces.
  - `57014`: 500 `{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}`.
  - `pass`: no fault. `GET /__fault` lists the RPC hits, which the GIF prints after each turn.
- **`provider-stub.mjs`**: Anthropic Messages, streamed as SSE. If the last message has no `tool_result`, it answers with one `tool_use` for `find_documents`; otherwise it answers with a short text. `POST /input/valid` sets `{"scope":"library","query":"indemnity"}`. `POST /input/invalid` sets `{"scope":"library","query":"x"}`: a 1-character query fails `findDocumentText`'s validation, so the result is `invalid_search` and no RPC is made. `library` scope was used so that no project or document was needed. The RPC fails before it reads any rows.
- **`helpers.sh`**:
  - `run <fault> <valid|invalid>` runs `clr` (empties the sink), `fault`, `tool`, `mark`, `turn`, `ev` and `apilog`.
  - `turn` does `POST /chat/create`, then `PATCH /chat/:id {"title":"gif777"}` (no title model call), then `POST /chat` with `claude-sonnet-5-5` and "search my documents for indemnity". It prints the SSE `doc_search` frame and the proxy's last RPC hit.
  - `apilog` greps the API log for the `find_documents` line written since `mark`.
  - `restartapi` stops this API by PID and starts a fresh one in the same worktree.
- **User**: throwaway `gif777-<ts>@mike.local` (id 3d596b6c-b799-4451-aec4-46a0c1122cff), created with GoTrue admin `POST /auth/v1/admin/users` (email_confirm). The bearer token comes from a password grant made fresh for each take.
- **Dry runs** (`dry.sh`, `dry2.sh`; logs `dry-*-api.log`, `dry2-main-api.log`, `take1-main-api.log`) ran before the takes and are not part of the evidence rows.

## pr777-before.gif (origin/main b91d1bdf4): 3 events, all the same untyped issue

| Case | Tool result / SSE `doc_search.error_code` | Sink event | API log |
|---|---|---|---|
| 1. PGRST202 | `schema_out_of_date` | **error** `Failure in chat.turn / application`, `capture_source=console operation=chat.turn`, no `error_kind`, no `failure_code`, occurrence 1 | `[find_documents] { category: 'schema_out_of_date', failure_code: 'PGRST202' }` (console.error) |
| 2. 57014 | `search_timeout` | **error**, same title and tags, occurrence 2 | `[find_documents] { category: 'search_timeout', failure_code: '57014' }` |
| 3. invalid args (fresh API) | `invalid_search` (no RPC) | **error**, same title and tags, occurrence 1 | `[find_documents] { category: 'invalid_search' }` |

All three events have the fingerprint `["{{ default }}","chat.turn","","","application","","",…]`. They are message-only: no exception, no frames, and the sink's `where` is null.

## pr777-after.gif (PR head 627428cf6): 2 events, invalid args files nothing

| Case | Tool result | Sink event | API log (console.warn) |
|---|---|---|---|
| 1. PGRST202 | `schema_out_of_date` | **error** `AppError: Failure in chat.tool / chat-stream / chat.document_search_failed / PGRST202` @ `toolDispatcher.ts:789` | `[run_tools] find_documents failed { category: 'schema_out_of_date', failure_code: 'PGRST202' }` |
| 2. 57014 | `search_timeout` | **warning** `AppError: … / chat.document_search_failed / 57014` @ `toolDispatcher.ts:789` | `… { category: 'search_timeout', failure_code: '57014' }` |
| 3. invalid args (same process) | `invalid_search` | **none (0 events)** | `… { category: 'invalid_search' }` |

- Both events have the tags `component=chat-stream operation=chat.tool error_kind=chat.document_search_failed failure_code=<code> capture_source=exception occurrence=1`.
- The fingerprints are `["{{ default }}","chat.tool","chat.document_search_failed","","chat-stream","","","","PGRST202"|"57014","",…]`, so the two codes are two issues.
- No console-bridge copy arrived for any of the three turns.
- The SSE frames and the user-visible messages are identical to main for all three cases.
- Raw rows are in `before-sink-events.jsonl` and `after-sink-events.jsonl`. The full sink output, including the dry runs, is in `sink.log`.

## Mismatches with comments/777.md, fixes/777.md and the brief

1. **Faults were injected by proxy, not in the DB.** The brief asked for this. Section 2 steps 4–5 rename the RPC and set `service_role` `statement_timeout`. The proxy returns the PostgREST bodies those steps would produce, for this backend only. What it cannot reproduce: a real timeout's latency, and PostgREST's exact `details` and `hint` wording (it is reconstructed from the function signature). The classification reads only `code`, so this does not change the result.
2. **No document upload or indexing (section 2 step 3).** It was not needed: the RPC fails before it reads any rows, and `library` scope needs no project.
3. **Culprit `log.ts` cannot be shown locally.** The before events are message-only console-bridge events (no exception, no frames, sink `where` null). The `src/lib/log.ts` / `logError` culprit in 6S/Y/2Q is computed by Sentry, and the sink does not reproduce it. The title, level, `capture_source=console` and missing `error_kind`/`failure_code` match section 2 step 7 exactly, including `operation=chat.turn` (6S's shape).
4. **Main also files the model's invalid arguments.** This goes beyond the comment, which treats `invalid_search` only as the after-side counterexample. On main, `logError` runs for every `!result.ok`, so a 1-character query files the same error-level issue (shown in the before GIF, case 3). Main's per-issue budget (occurrences 1, 2, 4, …) silently dropped the third same-title event in one process (dry run: `sink events: 0` for case 3). That is why case 3 of the before GIF runs on a fresh API process (`restartapi`, visible in the GIF). The after side needed no restart.
5. **The cause is not in the exception chain.** fixes/777.md and the brief say the PostgREST error rides as the AppError's `cause`. It does in code, and it is what supplies `failure_code`. But the sink's `exception.values` holds only the `AppError` (one value, top frame `toolDispatcher.ts:789`): the PostgREST error is a plain object, not an `Error`, so the linked-errors integration does not add it. The SQLSTATE reaches Sentry only as the tag and the title or fingerprint segment. The comment does not claim a chain, so this is just an observation.
6. **Title prefix.** Section 3 step 2 says `AppError: Failure in chat.tool / chat-stream / chat.document_search_failed / PGRST202`, and the sink matches it exactly.
7. **Head.** Section 3 names db0e35b97; this was recorded on 627428cf6 (fixes/777.md). The console.warn line carries `failure_code`, as fixes/777.md says. For `invalid_search` it carries only the category.
8. **Not recorded:** a successful search (no fault, valid query); the `unavailable` (search disabled) branch; a project chat versus a standalone chat. Section 4 lists all three as manual checks.

## Files

- `pr777-before.gif`, `pr777-after.gif`, and the unedited `pr777-before.mp4` and `pr777-after.mp4`.
- `before.tape`, `after.tape`, `setup-main.sh`, `setup-pr.sh`, `helpers.sh`, `fault-proxy.mjs`, `provider-stub.mjs`, `dry.sh`, `dry2.sh`.
- `before-sink-events.jsonl`, `after-sink-events.jsonl`, `sink.log`, `proxy.log`, `stub.log`, and the API logs `pr777-main-api.log` and `pr777-pr-api.log`.

## Cleanup

- Processes: everything I started was stopped by PID: the proxy, the stub, the sink, and each API (the tapes stop their API at the end). Nothing listens on :4777, :9777, :4177 or :54777. No Docker, compose or supabase commands were run, and no shared role or function was altered.
- Throwaway user: removed.
  - Its 19 chats and 38 messages were deleted.
  - So were its auto-created personal organization d890420f-… (deleted before its membership, because of the last-owner trigger), its default workflow installations (5), workflows (5), quick actions (7), memory_files row and user_profiles row.
  - Also deleted: the 19 `audit.chat_turn` `db_jobs` rows my turns enqueued (pending; `DB_JOBS_ENABLED=false`, so no runner of mine would have drained them).
  - The GoTrue user was then deleted (admin DELETE 200).
  - A scan of every `public` uuid column found 0 rows with its id, and `auth.users` and `db_jobs` have 0 rows for it.
- The token and password files were deleted, and worktrees `gif777-main` and `gif777-pr` were removed.

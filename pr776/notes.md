# PR #776 evidence: a blank supabase-js network failure now carries its errno

Recorded 2026-11-05 with vhs 0.11 (zsh, terminal only, 1700x680, cropped to 1700x410). Converted to GIF at 8 fps with a 64-colour palette and played at 1.0x. vhs `Wait` waits for the prompt, so no output is cut off.

The backend ran from source (`node --import tsx src/index.ts`) in two detached worktrees, against the shared local Supabase. No database objects or roles were altered. All faults are real undici errors: a fault proxy sits in front of this backend only (via its `SUPABASE_URL`), and for the targeted requests it answers `307` to an address the backend's own fetch cannot reach. undici raises the error, and supabase-js builds its normal blank-code result from it:

```
{ message: 'TypeError: fetch failed', code: '', hint: '',
  details: 'TypeError: fetch failed\n\nCaused by: Error: connect ECONNREFUSED 127.0.0.1:59999 (ECONNREFUSED)\n<stack>' }
```

That object is copied verbatim from `pr776-main-worker.log`. The model was a local Anthropic stub that answers with a `find_documents` tool_use. The sink was `scripts/sentry-sink.mjs`.

- `pr776-before.gif`: origin/main b91d1bdf4. 14.9 s, 192 KB.
- `pr776-after.gif`: PR head 92c043bff. 14.7 s, 236 KB.
- Raw URLs:
  - https://raw.githubusercontent.com/mlx51/mike/assets/pr776-demo-2026-11-05/pr776/pr776-before.gif
  - https://raw.githubusercontent.com/mlx51/mike/assets/pr776-demo-2026-11-05/pr776/pr776-after.gif

## Setup

```bash
git worktree add --detach ~/dev/mike-wt/gif776-main b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif776-pr   92c043bff
# root + backend node_modules cloned with cp -cR from worktrees with identical lockfiles:
#   main <- mike-wt/feature-flags, PR <- mike-wt/algo
# backend/.env in both = ~/dev/mike/backend/.env minus PORT/FRONTEND_URL/NODE_ENV/SENTRY_*/WORKERS_MODE/DB_JOBS_*/SUPABASE_URL
#   and every provider key, plus:
#   PORT=4776 FRONTEND_URL=http://127.0.0.1:3776 NODE_ENV=development SENTRY_DISABLED=false
#   SENTRY_DSN=http://mike@127.0.0.1:9776/1 WORKERS_MODE=none DB_JOBS_ENABLED=false
#   SUPABASE_URL=http://127.0.0.1:54776                 # fault proxy 1 (chat API)
#   ANTHROPIC_API_KEY=sk-ant-stub-deployment-DEPLOY ANTHROPIC_BASE_URL=http://127.0.0.1:4176/v1
PORT=54776            node fault-proxy.mjs > proxy.log    # chat API's gateway
PORT=54775 MODE=hold  node fault-proxy.mjs > proxy2.log   # worker backend's gateway (starts parked)
PORT=4176  node provider-stub.mjs > stub.log              # copied from mike-evidence/777
PORT=9776  node ~/dev/mike/scripts/sentry-sink.mjs > sink.log
# safety net on every backend: NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs" SINK_PORT=9776
#   (no [redirect] line in any log: every event came from the explicit sink DSN)
vhs before.tape   # sources setup-main.sh -> helpers.sh + worker.sh
vhs after.tape    # sources setup-pr.sh   -> helpers.sh + worker.sh
ffmpeg -i pr776-<side>.mp4 -vf "crop=1700:410:0:0,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr776-<side>.gif
```

### `fault-proxy.mjs`

Every request is piped unchanged to `127.0.0.1:54321`, except in the modes below. `POST /__fault/<mode>` switches the mode and `GET /__fault` lists the hits.

- `refused`: `POST /rest/v1/rpc/find_document_text` gets `307 http://127.0.0.1:59999/…`. That port is closed, so the result is ECONNREFUSED.
- `nxdomain`: the same request gets `307 http://nope.invalid:5432/…`, giving ENOTFOUND. Port `:1` cannot be used here, because undici's fetch rejects it as a "bad port" before DNS.
- `refused_all` / `nxdomain_all`: the same, for every `/rest/v1/*` request. Two things still pass: GoTrue `/auth/v1/*`, and the boot probe `rpc/document_lifecycle_version`. Without the probe the backend refuses to start: "Refusing to start without confirming lifecycle contract version 2".
- `hold`: every `/rest/v1/*` request except the boot probe is parked unanswered. Switching to `refused_all` releases the parked requests with that mode's 307.

### `worker.sh`

- `startworker` starts a second backend from the same worktree on :4775, with `WORKERS_MODE=thread` and `SUPABASE_URL=http://127.0.0.1:54775`. It starts behind proxy 2 in `hold` mode, so its upload worker's claim calls park and **never reach the shared database**. It cannot claim another recorder's job.
- `outage` clears the sink and switches proxy 2 to `refused_all`. The parked claim calls fail with a real ECONNREFUSED, and the script prints the sink.
- The worker backend is the one deviation from "WORKERS_MODE=none" in the brief, and the reason is above: no DB call from it was ever forwarded.

### `helpers.sh`

`run <mode>` does the following, in order:

1. Clears the sink and sets proxy 1's mode.
2. `POST /chat/create`.
3. `PATCH` the title. This skips the title model call.
4. `POST /chat` with "search my documents for indemnity".
5. Prints the SSE `doc_search` frame, the proxy hit, and the `tool_result` the stub received back. That `tool_result` is what the model is told.
6. Prints the sink events and the API's `[find_documents]` log line.

### User and dry runs

- **User**: throwaway `gif776-<ts>@mike.local` (id bb69a995-8822-4249-9683-665fb0a4612b), created with GoTrue admin `POST /auth/v1/admin/users` (email_confirm). Each take gets its token from `token.sh`: admin `generate_link` (magiclink), then `/auth/v1/verify`.
- **Dry runs**: `dry.sh`, `dry2.sh`, `dry3.sh`, `dry4.sh` and `dry5.sh`, with their `dry*-*.log` files. They ran before the takes and are not part of the evidence rows. Two earlier vhs takes were discarded: the after side's outage scene was cut off by a fixed `Sleep` while the machine had load ≈25, and one take failed on a `Wait` regex.

## pr776-before.gif (origin/main b91d1bdf4)

| Case | `doc_search.error_code` = tool_result to model | API log | Sink event |
|---|---|---|---|
| 1. `refused` (ECONNREFUSED on the RPC) | `internal_error`, "Document search could not be completed. Try again." | `[find_documents] { category: 'internal_error' }` | **error** `Failure in chat.turn / application`, `capture_source=console operation=chat.turn role=api`, no `failure_code`, occurrence 1 |
| 2. `nxdomain` (ENOTFOUND) | `internal_error`, same text | `[find_documents] { category: 'internal_error' }` | same title and tags, occurrence 2 |
| 3. `outage` (worker gateway refused) | n/a | `[upload-worker] iteration failed` with the blank-code object shown above | **error** `Error: Failure in upload-worker / iteration`, `component=upload-worker stage=iteration role=worker-thread capture_source=exception`, **no `failure_code`**. Fingerprint `["{{ default }}","","","","upload-worker","iteration","","","","",…]` |

Case 3 matches MIKE-BACKEND-X's shape as section 2 step 5 of the comment describes it. The before stack shows `asReportableError` at `httpError.ts:92` called from `uploads.processing.ts:1305`. The comment says 1322, but that line number comes from X's production build.

## pr776-after.gif (PR head 92c043bff)

| Case | `doc_search.error_code` = tool_result to model | API log | Sink event |
|---|---|---|---|
| 1. `refused` | **`search_unavailable`**, "Document search is temporarily unavailable. Please try again shortly." | `[find_documents] { category: 'search_unavailable', failure_code: 'ECONNREFUSED' }` | `Failure in chat.turn / application`. Title and tags are **unchanged** (see mismatch 1) |
| 2. `nxdomain` | **`search_unavailable`** | `[find_documents] { category: 'search_unavailable', failure_code: 'ENOTFOUND' }` | same, occurrence 2 |
| 3. `outage` | n/a | same blank-code object | **error** `Error: Failure in upload-worker / iteration / ECONNREFUSED`, the same tags **plus `failure_code=ECONNREFUSED`**. Fingerprint `["{{ default }}","","","","upload-worker","iteration","","","ECONNREFUSED","",…]` |

The fingerprint's `failure_code` slot is now filled, so this is a new issue rather than X, as section 3 step 2 says. Raw rows are in `before-sink-events.jsonl` and `after-sink-events.jsonl`.

## Mismatches with comments/776.md, fixes/776.md and the brief

1. **The find_documents sink event does not gain `failure_code`.** The brief expected the find_documents event to carry `failure_code=ECONNREFUSED` in its title and fingerprint. On both heads, the find_documents failure reaches Sentry only through `logError("find_documents", …)`, so it arrives as a console-bridge message event: `Failure in chat.turn / application`, `capture_source=console`, with no `failure_code` tag and no exception. That is the same shape #777's notes recorded for PGRST202. The PR changes the **log context** (`failure_code: 'ECONNREFUSED'` / `'ENOTFOUND'`) and the **tool result** (`search_unavailable`), but not that event. The tagged event the PR does change is the reported exception path, shown as case 3 (upload-worker / iteration, MIKE-BACKEND-X).
   - A dry run (`dry2.sh`, PR head) also showed the http path. With the whole gateway refused, the auth middleware's account-deletion lookup files `AppError: Failure in http / db.query_failed / POST / /chat / 500 / ECONNREFUSED` with `failure_code=ECONNREFUSED`.
   - That http path was not recorded on main. It is also slow: postgrest-js retries the GETs with backoff, about 7 s per request.
   - Once #777 merges, the find_documents failure becomes an `AppError` capture and gains the code, as the comment's section 7 notes.
2. **No `chat-stream / … / internal_error` event exists for this failure.** The brief mentions one. Neither head produces one: find_documents failures do not end the turn. The turn finishes normally, with the stub's text answer.
3. **Fault injection.** The faults came from a proxy 307 to a closed port or a non-resolving host. The comment's recipe instead edits `SUPABASE_URL` to `:59999` or stops Kong. The proxy method yields the same undici errors and the same supabase-js object, and it does not disturb other recorders. `SUPABASE_URL` could not point at a closed port for the chat turns, because chat creation and message persistence need PostgREST. Per-request ENOTFOUND was possible through the same 307 mechanism, so the second variant **was** recorded (case 2).
4. **Upload worker ran with `WORKERS_MODE=thread`** on a second process, behind a proxy in `hold` mode. No DB call from it was forwarded (see Setup). The brief said `WORKERS_MODE=none`. That was kept for the chat API (:4776).
5. **`fetch_failed` (optional) was not produced.**
   - A provider fetch failure (`ANTHROPIC_BASE_URL` at a closed port, `dry4.sh`) files `Error: Failure in chat.turn / chat-stream / chat.stream_failed / ECONNREFUSED / retry_exhausted` with `failure_code=ECONNREFUSED`, **identically on main and the PR**: the AI SDK's chain holds a real undici cause with `code`, so the fallback never applies.
   - `fetch_failed` appears only when nothing on the chain carries a code. Producing that cheaply was not possible without code changes, so it was skipped.
6. **Head and stale details.** The comment's section 3 names ac5bc5f7b; this was recorded on 92c043bff (fixes/776.md). The `search_unavailable` user copy is the optional extra step fixes/776.md asks for, and it matches.
7. **Not recorded:** an upload with the gateway up (no event); the frontend/add-in copy (`packages/client`); and 6T's dbq path (`DB_JOBS_ENABLED=false`).

## Cleanup

- **Processes**: everything I started was stopped by PID:
  - both proxies, the stub and the sink;
  - each API and worker backend (the tapes stop them at the end);
  - two leftover backends from an aborted take (PIDs 19606/19878 and 21275/21369, confirmed by cwd `gif776-*`).
  - Nothing listens on :4775, :4776, :4176, :9776, :54775 or :54776. No Docker, compose or supabase commands were run.
- **Throwaway user**:
  - Its chats were deleted (23), along with their messages (44).
  - Also deleted: its personal organization, its membership, its default workflow installations (5) and workflows (5; their 7 quick actions cascaded), its memory_files row and its user_profiles row.
  - So were the 20 `db_jobs` rows whose payload named it: pending `audit.chat_turn` jobs, which no runner of mine drained.
  - The GoTrue user was then deleted (admin DELETE 200). A scan of every `public` and `audit` uuid/text column found 0 rows with its id, and `auth.users` has 0 rows for it.
- **Files and worktrees**: the env copy and the user id/email scratch files were deleted, and worktrees `gif776-main` and `gif776-pr` were removed.

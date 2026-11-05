# PR #794 evidence: gateway stream failures, hop-by-hop headers, client aborts

Recorded 2026-11-05 with vhs (zsh terminal only, 1700x760), played back at 1.4x and converted to GIF at 8 fps with a 64-colour palette.
Everything goes through the real Next same-origin gateway (`next dev` on :3794, `frontend/src/app/api/[...path]/`) to the real backend from source (:4794, `node --import tsx src/index.ts`, `WORKERS_MODE=none`, `DB_JOBS_ENABLED=false`) against the shared local Supabase (:54321 / :54322). The model provider was a local Anthropic stub on :4194 (`provider-stub.mjs`) that streams `w1 w2 ...` one word every 400 ms. The sink was `scripts/sentry-sink.mjs` on :9794. Next reported to project 2, the backend to project 1. Every event shown is project 2 (Next).

- `pr794-before.gif`: origin/main b91d1bdf4. 23.3 s, 212 KB (recorded 32.6 s).
- `pr794-after.gif`: PR head 221db05c9. 23.5 s, 178 KB (recorded 33.0 s).
- Raw: https://raw.githubusercontent.com/mlx51/mike/assets/pr794-demo-2026-11-05/pr794/pr794-before.gif and https://raw.githubusercontent.com/mlx51/mike/assets/pr794-demo-2026-11-05/pr794/pr794-after.gif

## Setup

```bash
git worktree add --detach ~/dev/mike-wt/gif794-main b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif794-pr  221db05c9
# node_modules (root, backend, frontend) cloned with cp -cR from ~/dev/mike-wt/feature-flags (identical lockfiles)
# backend/.env = ~/dev/mike/backend/.env minus PORT, FRONTEND_URL, NODE_ENV, SENTRY_*, GEMINI/ANTHROPIC/OPENAI/RESEND/COURTLISTENER keys, plus:
#   PORT=4794 FRONTEND_URL=http://127.0.0.1:3794 NODE_ENV=development SENTRY_DISABLED=false SENTRY_DSN=http://mike@127.0.0.1:9794/1
#   WORKERS_MODE=none DB_JOBS_ENABLED=false ANTHROPIC_API_KEY=sk-ant-stub-deployment-DEPLOY ANTHROPIC_BASE_URL=http://127.0.0.1:4194/v1
# frontend/.env.local = NEXT_PUBLIC_SUPABASE_* from ~/dev/mike/frontend/.env.local, plus:
#   API_BASE_URL=http://127.0.0.1:4794 SENTRY_DSN=http://mike@127.0.0.1:9794/2 NEXT_PUBLIC_SENTRY_DSN=http://mike@127.0.0.1:9794/2
PORT=4194 node provider-stub.mjs > stub.log
PORT=9794 node ~/dev/mike/scripts/sentry-sink.mjs > sink.log
export SINK_PORT=9794 STATUS_LOG=$E/<before|after>-status.log \
  NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs --require ~/dev/mike-evidence/794/log-api-status.cjs"
(cd ~/dev/mike-wt/gif794-<main|pr>/frontend && npx next dev -p 3794 -H 127.0.0.1)   # fresh process per take, warmed with GET /api/health
vhs before.tape    # sources setup-main.sh (starts the backend, sources helpers.sh)
vhs after.tape     # sources setup-pr.sh
ffmpeg -i pr794-<side>.mp4 -vf "setpts=PTS/1.4,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr794-<side>.gif
```

- `helpers.sh`: `newchat` (POST /api/chat/create + PATCH a title, so no title model call), `ask <chat> [curl opts]` (POST /api/chat, raw SSE), `words` (prints the streamed text on one line), `ev` (sink events: level, title, non-empty fingerprint parts, key tags), `clr`, `api_start`. All requests go to `$GW=127.0.0.1:3794/api/...` with a bearer token.
- `log-api-status.cjs` is an observation-only preload for the Next server. It logs the status the app finally assigns to an `/api/*` response, including after the client has gone. It is needed because Next's own request log reads the status at disconnect time: it prints `GET /api/user/profile 200 in 2.0s` on **both** heads in case C, before the handler has answered. App code was not patched.
- User: throwaway `gif794-1793919045@mike.local` (id e3fc8ad0-...), created with the GoTrue admin API; bearer token from an admin magiclink + `/auth/v1/verify`.
- No `[redirect]` line in any log: nothing reached a real Sentry project.

## What each GIF runs

A) `id=$(newchat); (sleep 4.5; kill -9 $(cat $E/api.pid)) &!; ask $id | words; echo "curl exit $s"; ev`: a chat answer streaming through the gateway; the backend process (my own, by PID) is SIGKILLed mid-answer.
Then `api_start` restarts the backend.
B) `curl -H 'Expect: 100-continue' -H 'Transfer-Encoding: chunked' -X POST $GW/api/chat/create -d '{}'`.
C) `kill -STOP <backend pid>; curl -m 2 -s -o /dev/null $GW/api/user/profile; kill -CONT <backend pid>; tail -1 $STATUS_LOG; ev`: the client gives up before the backend has answered.
C2) `ask $(newchat) -m 3.5 | words; ev`: the client gives up mid-answer.

## pr794-before.gif (origin/main b91d1bdf4)

| Case | Client sees | Sink (Next, project 2) |
|---|---|---|
| A | `w1 w2 w3 w4`, **curl exit 18** | 1 event: `level=error` `SocketError: Failure in application / UND_ERR_SOCKET`, fingerprint `{{ default }}, application, UND_ERR_SOCKET`, tags `failure_code=UND_ERR_SOCKET capture_source=exception occurrence=1`, no component/stage/route/request_id. Next log: `⨯ Error: failed to pipe response ... [cause]: TypeError: terminated ... [SocketError]: other side closed, code: 'UND_ERR_SOCKET'` |
| B | **HTTP 502** `{"detail":"The API is temporarily unavailable.","request_id":...}` | 1 event: `level=error` `NotSupportedError: Failure in api-gateway / gateway-fetch / POST / /chat/:id / 502 / fetch_failed`, tags `component=api-gateway stage=gateway-fetch http_route=/chat/:id http_status=502 failure_code=fetch_failed`. Next log: `code: 'UND_ERR_NOT_SUPPORTED'` |
| C | curl exit 28 | 0 events. Status log: `GET /api/user/profile -> 200 (client gone)`: the backend request ran to completion after the client left |
| C2 | `w1 w2 w3`, curl exit 28 | 0 events |

## pr794-after.gif (PR head 221db05c9)

| Case | Client sees | Sink (Next, project 2) |
|---|---|---|
| A | `w1 w2 w3`, **curl exit 18** | 1 event: **`level=warning`** `SocketError: Failure in api-gateway / gateway-stream / POST / /chat / 200 / UND_ERR_SOCKET`, fingerprint **`upstream-unavailable, api-gateway, UND_ERR_SOCKET`**, tags `component=api-gateway stage=gateway-stream http_method=POST http_route=/chat http_status=200 request_id=<uuid> failure_code=UND_ERR_SOCKET capture_source=exception occurrence=1`. Next log: `[api-gateway] upstream response stream failed TypeError: terminated` (console.warn), no `failed to pipe response` |
| B | **HTTP 200** `{"id":"8ec2f5b7-..."}` (the backend created the chat) | 0 events |
| C | curl exit 28 | 0 events. Status log: **`GET /api/user/profile -> 499 (client gone)`** |
| C2 | `w1 w2 w3 w4`, curl exit 28 | 0 events |

Off camera, same PR head, fresh Next process: three chat streams broken by three backend kills within one minute. All three curls exit 18; the Next log has three `upstream response stream failed` lines; the sink has **one** event (the warning above, occurrence 1). Rows: `window-sink-events.jsonl`, log `window-frontend.log`.

Raw rows: `before-sink-events.jsonl`, `after-sink-events.jsonl`. Next logs: `before-frontend.log`, `after-frontend.log`. Status logs: `before-status.log`, `after-status.log`. Backend logs: `pr794-main-api.log`, `pr794-pr-api.log`.

## Mismatches with comments/794.md, fixes/794.md and the brief

1. **On main the broken stream does not close cleanly.** The brief says that on main "the response closes cleanly as if complete". Live, curl exits **18** (transfer closed with outstanding read data) on main in every take: the recorded one and five off-camera trials with the kill at 2.3 to 3.5 s. This matches comments/794.md section 2 step 3 ("curl exits 18"). So for curl the client-visible result is the same on both heads, which is what section 5 of the comment says. Case A's difference is only on the Sentry side: error, default grouping, no context on main, versus one pinned warning with stage, route and request id on the PR. My first dry run printed `curl exit 0` on main, but that was my bug: an `echo` reset `$pipestatus`. Only `next dev` was tested, not `next start` (a production build was not made: 8 GB machine, 5.7 GB free disk).
2. **Main's event is not fully context-free.** It is `SocketError: Failure in application / UND_ERR_SOCKET` with a `failure_code=UND_ERR_SOCKET` tag. It has no component, stage, route or request id, which matches comments/794.md ("2V and Y").
3. **Case C: a 499 is only observable server side, and only when the client leaves before the headers.** With `curl -m 2` mid-stream (C2) the headers are already out, so there is no 499 to see. Next's request log prints `200` on both heads either way, because it reads the status at disconnect time. To show the 499 I paused my own backend with `kill -STOP <pid>` so the client left before the headers, and I logged the final status with the observation preload. Main: `200 (client gone)`, so the backend call was not aborted. PR: `499 (client gone)`. Neither head filed an event in C or C2. `timeout` is not installed on this Mac; `curl -m` was used instead.
4. **Case B header shape.** The brief says the before shape is "InvalidArgumentError/NotSupportedError". With both `Expect: 100-continue` and `Transfer-Encoding: chunked` on the request, main answers with **`NotSupportedError`** (`UND_ERR_NOT_SUPPORTED`), the `Expect` shape (3M). The order in which undici checks the two headers was not checked. The `InvalidArgumentError` (4B/4A) shape was not separately recorded. comments/794.md step 4 gives the same 502 with the `Expect` header alone. Its route is `/chat/:id` because `diagnosticRoute` maps `/chat/create` to `/chat/:id`.
5. **Head.** comments/794.md section 3 names 4a0af8c71. This was recorded on 221db05c9, as fixes/794.md says.
6. **Not shown (as instructed):** a resume after a backend restart. It 404s on both heads (fixes/794.md). The browser resume path (comment section 3 step 3), the body-timeout error-level path, EPIPE at fetch time and downloads were not recorded either.

## Cleanup

- Processes: the provider stub, the sink, every `next dev` (npx, next and next-server PIDs) and every backend I started were stopped by PID. Nothing listens on :3794, :4794, :9794 or :4194. Two other `sentry-sink.mjs` processes (PIDs 319 and 6901) belong to other recorders and were left alone.
- `frontend/AGENTS.md` was restored with `git checkout --` in both worktrees, and then the worktrees `gif794-main` and `gif794-pr` were removed.
- Throwaway user: deleted 29 chats (their messages went with them), 5 default_workflow_installations, 7 quick_actions, 5 workflows, 1 memory_files row, the personal organization 4b951922-... (with its membership), 1 org_members row and the user_profiles row. Then the GoTrue user was deleted (200). A scan of every public uuid column found nothing left for the user id or the org id. The token file was deleted.

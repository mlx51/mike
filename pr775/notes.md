# PR #775 evidence: chat turn outcomes and the browser's Sentry events

Recorded 2026-11-05 with the Chrome DevTools MCP screencast (isolated browser context `gif775`, 2880x1454 viewport). Converted at 1.2x speed, 8 fps, 1280 px.
Stack: the shared local Supabase CLI stack (:54321 / :54322). A real backend from source on :4875 (`npx tsx src/index.ts`, `WORKERS_MODE=none`, `DB_JOBS_ENABLED=false`). `next dev` on :3875. Sink `scripts/sentry-sink.mjs` on :9875. A fault proxy on :4876 and an Anthropic streaming stub on :4195.
User: a throwaway account `gif775-1793920342@mike.local` (id d07a69b3-…), created with the GoTrue admin API and password login. Its profile was set to display_name "Ada Lovelace" and onboarding_version 0. The dev account was not touched.

| GIF | Ref | Length | Size |
|---|---|---|---|
| `pr775-before.gif` | origin/main b91d1bdf4 | 21.4 s | 1.1 MB |
| `pr775-after.gif` | PR head c02b85d26 | 23.3 s | 0.9 MB |

Raw:
- https://raw.githubusercontent.com/mlx51/mike/assets/pr775-demo-2026-11-05/pr775/pr775-before.gif
- https://raw.githubusercontent.com/mlx51/mike/assets/pr775-demo-2026-11-05/pr775/pr775-after.gif

## The six cases (same order and messages in both GIFs)

The dark label at the bottom right is a recording aid. It is a plain DOM div injected with `evaluate_script`; it does not wrap `fetch` or touch Sentry. The same script arms the proxy (`GET :4876/__fault/<code>`, no-cors) and sends the message through the real composer (textarea value, then a click on "Send message"). Stop was a click on the real "Stop response" button 2.8 s into the stream.

1. Proxy: `POST /chat` -> 503 `{"code":"upstream_unavailable", ...}`
2. Proxy: `POST /chat` -> 429 `{"code":"rate_limited","detail":"Too many chat requests. Please try again later."}` (the backend chat limiter's body)
3. A real turn: the stub streams one word every 350 ms, and the user presses Stop. The UI shows "Cancelled by user."
4. Proxy: `POST /chat` -> 400 `{"detail":"prompt is too long"}` (no code, like the route's own 400s)
5. Proxy: `POST /chat` -> 409 `{"code":"turn_in_progress", ...}` (the coded refusal, chat.routes.ts body)
6. Proxy: `POST /chat` -> 500 `{"code":"internal_error","detail":"Something went wrong. Please try again.", ...}` (the genuine fault, sendInternalError body)

The UI is the same on both refs: same toasts ("Too many chat requests…", "prompt is too long", "A response is already being generated…", "The answer may still be running…" for 503/500) and the same "Cancelled by user." marker.

## Sink events (browser, project 2; all `runtime=browser build_mode=development install=community capture_source=exception occurrence=1`)

### Before (main b91d1bdf4): 5 events
| Case | Level | Title | Tags |
|---|---|---|---|
| 503 | error | `Error: Failure in chat.turn / assistant-chat / 503` | component=assistant-chat operation=chat.turn project=false dependency_status=503 |
| 429 | error | `Error: Failure in chat.turn / assistant-chat / 429` | same, dependency_status=429 |
| Stop | none | - | - |
| 400 | error | `Error: Failure in chat.turn / assistant-chat / 400` | same, dependency_status=400 |
| 409 | error | `Error: Failure in chat.turn / assistant-chat / 409` | same, dependency_status=409 |
| 500 | error | `Error: Failure in chat.turn / assistant-chat / 500` | same, dependency_status=500 |

No event on main carries `error_code`, although every proxied body except the 400 had a `code`.

### After (PR c02b85d26): 2 events
| Case | Level | Title | Tags |
|---|---|---|---|
| 503 | none | - | - |
| 429 | none | - | - |
| Stop | none | - | - |
| 400 | **warning** | `Error: Failure in chat.turn / assistant-chat / 400` | component=assistant-chat operation=chat.turn project=false dependency_status=400 |
| 409 | none | - | - |
| 500 | error | `Error: Failure in chat.turn / assistant-chat / internal_error / 500` | component=assistant-chat operation=chat.turn project=false **error_code=internal_error** dependency_status=500 |

Raw rows: `before-sink-events.jsonl`, `after-sink-events.jsonl`. Sink terminal log: `sink.log`. Proxy log (every armed fault and answered request): `proxy.log`. Stub log: `stub.log`.

## Mismatches with the brief, comments/775.md and fixes/775.md

1. **Main files one event per failed turn, not several copies.** The brief and comments/775.md §2 expect the automatic capture, the console-bridge copy and the hook's report. On main only the hook's explicit `reportError` arrived (capture_source=exception, component=assistant-chat). No `capture_source=unhandled` or `console` event and no `Failure in application / 4xx` appeared for any case. The automatic/console copies (MIKE-FRONTEND-X, 2S, 1A…) are not reproduced by this chat flow on a fresh main; the scrubber half of the PR is covered only by its unit tests here.
2. **Stop files nothing on main either.** Pressing Stop mid-stream shows "Cancelled by user." and sends no event on both refs. Navigating away mid-stream (tried on main, not recorded) also sent nothing: the server-owned run keeps streaming and the client does not throw an unhandled AbortError. The `AbortError: Failure in application` shape (2N) did not reproduce live.
3. **A 503 turn files nothing after the fix, not "exactly one assistant-chat event".** The brief expected one event. `reportFault` classifies 503 as kind "unavailable", which is neither a fault nor an unexplained refusal, so the hook does not report it. That matches comments/775.md §5 ("A 503 chat refusal is no longer reported from the hook") and fixes/775.md ("a 503 not at all on the uncertain path"). The "genuine fault -> one assistant-chat event with the project tag" claim was shown with a 500 instead (case 6): one error-level event, component=assistant-chat, project=false.
4. **Model-stub 503/429/400 do not reach the hook's catch.** The brief asked for the model stub to answer 503/429/400. A provider failure arrives as an SSE `error` frame with `reporting_owner: "backend"`, which `reportRealFault` skips on both refs (only the backend files it, see #792's evidence). To exercise the hook's failure branch, the statuses were injected on the HTTP response of `POST /chat` by the proxy instead. The model stub was used only for the streaming/Stop case.
5. **The 400 has no deliberate code.** The 400 body mirrors the chat route's validation 400s (`{detail}` only). A 400 never counts as a handled outcome anyway (UNEXPLAINED_REFUSAL_STATUSES), so after the fix it is a warning whatever the code.
6. **Coded refusal used: 409 `turn_in_progress`** (one of the two codes this PR adds to CODE_KINDS). Also dropped after the fix: 429 `rate_limited`.
7. **comments/775.md §3 step 3 is out of date** (fixes/775.md says so too): the 500 event has component=assistant-chat and a `project` tag, not component=notify.
8. `request_id` is null in both 500 events: the proxy put `request_id` in the body only, not in the response header, so this says nothing about the PR. The PR adds `error_code=internal_error` (and the code in the title) for the 500.
9. Not recorded: a project chat (project=true), the dev-server `zz-boom` counterexample, the compile-frame rule, and the Word add-in.

## Commands

```bash
git worktree add --detach ~/dev/mike-wt/gif775 b91d1bdf4         # later: git checkout --detach c02b85d26 (same lockfiles)
# node_modules: cp -cR from ~/dev/mike-wt/feature-flags (frontend, backend; root is a symlink); identical lockfiles on both refs
# backend/.env = ~/dev/mike/backend/.env minus PORT, FRONTEND_URL, provider/Resend/CourtListener keys, RATE_LIMIT_CHAT_MAX, plus:
#   PORT=4875 FRONTEND_URL=http://127.0.0.1:3875 ALLOWED_ORIGINS=http://127.0.0.1:3875,http://localhost:3875
#   NODE_ENV=development SENTRY_DISABLED=false SENTRY_DSN=http://mike@127.0.0.1:9875/1
#   WORKERS_MODE=none DB_JOBS_ENABLED=false RATE_LIMIT_CHAT_MAX=1000
#   ANTHROPIC_API_KEY=sk-ant-stub-775 ANTHROPIC_BASE_URL=http://127.0.0.1:4195/v1
# frontend/.env.local = NEXT_PUBLIC_SUPABASE_* from ~/dev/mike/frontend/.env.local plus
#   API_BASE_URL=NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4876 (the proxy)
#   SENTRY_DSN=NEXT_PUBLIC_SENTRY_DSN=http://mike@127.0.0.1:9875/2
PORT=9875 node ~/dev/mike/scripts/sentry-sink.mjs
PORT=4195 node anthropic-stream-stub.mjs
PORT=4876 UPSTREAM=http://127.0.0.1:4875 node chat-fault-proxy.mjs      # GET /__fault/<503|500|429|409|400|off> arms ONE POST /chat
(cd backend && npx tsx src/index.ts)
(cd frontend && npx next dev -p 3875 -H 127.0.0.1)
curl -s -X DELETE http://127.0.0.1:9875/events                           # before each take; page reloaded before each take
# GIFs (mkgif.sh for before; after cut the 7 s idle hold on the last toast):
bash mkgif.sh before.mp4 7.6 30.5 before-sink.mp4 1.5 pr775-before.gif 1.2
ffmpeg -i after.mp4 -filter_complex "[0:v]trim=6.8:29.5,setpts=PTS-STARTPTS[x];[0:v]trim=36.6:42.4,setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[c];[c]setpts=PTS/1.2,fps=8,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse" -loop 0 pr775-after.gif
```

Dry runs (each case once on main, and the 500 once on the PR) went before the recordings, with the sink cleared afterwards.

## Cleanup

- Sink, stub, proxy, both backends and both `next dev` processes stopped by PID (`pids.txt`); :3875, :4875, :4876, :9875 and :4195 are free.
- `frontend/AGENTS.md` restored after each `next dev`; worktree `gif775` removed.
- Chrome page closed.
- Throwaway user removed: 8 chat_messages, 3 chats, 7 quick_actions, 5 default_workflow_installations, 5 workflows, 1 memory_files row, its personal organization (with its membership) and its user_profiles row; GoTrue delete 200. A scan of every uuid column in `public` and `auth` found no row left with its id.

# PR #793 evidence: one GoTrue failure, one Sentry event; outage answers 503 instead of signing the user out

Recorded 2026-11-05 with the Chrome DevTools MCP screencast (isolated browser context, 2880x1454 viewport), converted at 8 fps / 1280 px.
Real local stack: shared Supabase CLI stack (:54321 / :54322), a real backend from each worktree on :4793 (`npx tsx src/index.ts`, `WORKERS_MODE=none`, `DB_JOBS_ENABLED=false`), `next dev` on :3793, sink `scripts/sentry-sink.mjs` on :9793, logged in as the local dev account.

| GIF | Ref | Length | Size |
|---|---|---|---|
| `pr793-before.gif` | origin/main b91d1bdf4 | 21.4 s | 580 KB |
| `pr793-after.gif` | PR head aa8b8364f | 17.8 s | 476 KB |
| `pr793-before-navigate.gif` | origin/main b91d1bdf4 | 19.6 s | 696 KB |
| `pr793-after-navigate.gif` | PR head aa8b8364f | 22.8 s | 1.1 MB |

`pr793-before/after` = the requested flow (reload a page, then try to log back in): shows the four-to-one event change.
`pr793-before/after-navigate` = in-app navigation (click a project) with no reload: shows "stays signed in" (see mismatch 1 below for why the reload clip cannot show that).

## Fault injection (backend only)

`gotrue-fault-proxy.mjs` (this folder, not in the repo) sits between the backend and the Supabase gateway: the backend's `SUPABASE_URL=http://127.0.0.1:54793` -> proxy -> `:54321`. With the fault on it destroys the socket of every `/auth/v1/*` request (auth-js sees a network error: `AuthRetryableFetchError`, status 0) and passes `/rest/v1`, `/storage/v1` etc. through unchanged. `GET /__fault/on|off` toggles it; `proxy.log` lists each reset (`[fault] reset GET /auth/v1/user`, `[fault] reset POST /auth/v1/token`). The browser keeps its session cookies; the frontend never talks to GoTrue directly. The fault is switched on during each recording, after the signed-in page has loaded.

The bottom-right box in the clips is a recording aid injected into the page (initScript / evaluate): a `PerformanceObserver` listing every `/api/*` response with status >= 400 (path, status). Its first version wrapped `window.fetch`; that **suppressed the browser's Sentry event** (an injected frame on the error stack), so it was replaced with Resource Timing, which does not touch fetch. All recorded runs used the Resource Timing version.

## Sink events (verbatim titles/tags)

Each recording started from a freshly started backend and a full page load, so every event is `occurrence=1` (the per-runtime budget sends occurrences 1, 2, 4, 8 ... per issue; a third identical failure in one process is dropped, which is why the backend was restarted before each take).

### pr793-before.gif (main): reload -> 401 -> /login; log in -> 500 internal_error; **4 events**
```
project=1 error  AuthRetryableFetchError: Failure in auth.signin / http / auth.supabase_unavailable / 500
   operation=auth.signin component=http http_status=500 error_kind=auth.supabase_unavailable capture_source=exception
project=1 error  Failure in auth.signin / http / POST / /auth/login / 500          (sanitizer)
   operation=auth.signin component=http http_status=500 request_id=0dd157e5-... http_method=POST http_route=/auth/login capture_source=exception
project=1 error  Failure in auth.signin / application                             (console bridge)
   operation=auth.signin capture_source=console
project=2 error  Failure in mike-api / POST / /api/auth/login / 500 / internal_error   (browser)
   runtime=browser component=mike-api http_status=500 request_id=0dd157e5-... error_code=internal_error
```
The reload itself (`GET /api/auth/session -> 401`) files nothing. UI: "Couldn't log in / Something went wrong on our side. Try again." with Contact support + Retry.

### pr793-after.gif (PR head): reload -> 503 -> still /login; log in -> 503; **one event per failed request, 2 requests = 2 events**
```
project=1 error  AuthRetryableFetchError: Failure in http / auth.supabase_unavailable / GET / /auth/session / 503
   component=http http_status=503 request_id=3313d839-... http_method=GET http_route=/auth/session error_kind=auth.supabase_unavailable capture_source=exception
project=1 error  AuthRetryableFetchError: Failure in auth.signin / http / auth.supabase_unavailable / POST / /auth/login / 503
   operation=auth.signin component=http http_status=503 request_id=9cfde188-... http_method=POST http_route=/auth/login error_kind=auth.supabase_unavailable capture_source=exception
```
No sanitizer copy, no console copy, no browser event. UI: "Couldn't log in / The server is temporarily unreachable. Please try again shortly."

### pr793-before-navigate.gif (main): click a project -> 4 x 401 -> signed out to /login; **0 events**
`/api/projects/:id`, `/api/projects/:id/chats`, `/api/tabular-review` all 401 (requireAuth). Notice: "Couldn't check your session / Your session expired. Please log in again." The sink stays empty: on main a GoTrue outage on ordinary API routes is invisible to Sentry and signs the user out.

### pr793-after-navigate.gif (PR head): click a project -> 4 x 503 upstream_unavailable -> stays signed in; Retry after recovery loads the project; **one backend event per failed request (5)**
```
project=1 error  AuthRetryableFetchError: Failure in http / auth.supabase_unavailable / GET / /projects/:id / 503          occurrence=1 and 2
project=1 error  AuthRetryableFetchError: Failure in http / auth.supabase_unavailable / GET / /projects/:id/chats / 503    occurrence=1 and 2
project=1 error  AuthRetryableFetchError: Failure in http / auth.supabase_unavailable / GET / /tabular-review / 503        occurrence=1
   all: component=http http_status=503 http_method=GET http_route=<route> error_kind=auth.supabase_unavailable capture_source=exception, distinct request_ids
```
(The /projects/:id pair is the dev build's double fetch: two requests, two events, occurrence 1 and 2.) UI: "Couldn't load this project / The server is temporarily unreachable. Please try again shortly." with Contact support + Retry; sidebar "Could not load items. Retry"; GoTrue restored, Retry clicked, the project's Documents view loads without a new sign-in. No browser event.

Raw rows (raw envelope stripped): `before-sink-events.jsonl`, `after-sink-events.jsonl`, `before-navigate-sink-events.jsonl` (empty), `after-navigate-sink-events.jsonl`; dry runs: `before-dryrun-login-sink-events.jsonl`, `after-reload-dryrun-sink-events.jsonl`, `after-navigate-dryrun-sink-events.jsonl`.

## Mismatches with comments/793.md and the brief

1. **Reload does not keep the user signed in on the PR head.** The backend now answers `GET /auth/session` with 503 `upstream_unavailable` (main: 401), but `AuthContext` leaves `user` null when the initial session fetch throws, so the layout still redirects to `/login`. The login page then shows **two** "Couldn't check your session" notices: the toast from `reportSessionFailure` ("The server is temporarily unreachable...", with Contact support, fired while the route was still /projects so the `isOnAuthRoute()` guard did not apply) and the login page's own `authError` warning ("We could not check your session. Please try again."). The brief's "after: reload, user stays signed in, sees the retry notice" holds only for in-app navigation, which is why the `-navigate` pair was added. The fix-pass note ("reloading a project page ... stays signed in") overstates it.
2. **"Exactly one event" is per failed request, not per page/outage.** After the fix each failing API request files one backend event (no fan-out), titled per route. One project click during an outage filed 5 events across 3 issues; main filed **0** for the same click (requireAuth 401s were never reported). So for ordinary routes the PR adds events during an outage (bounded by the 1/2/4/8 budget per issue per process). For the auth routes it is the promised 4 -> 1.
3. **Exception title.** comments/793.md §2/§3 call the events `AppError: Failure in ...`. The sink shows `AuthRetryableFetchError: Failure in ...` on both refs (the event takes the type of the underlying auth-js error). Same for the after title, which is `AuthRetryableFetchError: Failure in auth.signin / http / auth.supabase_unavailable / POST / /auth/login / 503` (route and 503 present, matches otherwise).
4. **requireAuth / session events carry no `operation` tag** (title starts `Failure in http / ...`), unlike the login event (`operation=auth.signin`). `GET /auth/session` on the PR is also untagged (on main the comment lists `auth.session` titles for that route).
5. **Browser event on main is timing-sensitive**: it arrives about 1.5 s after the 500; navigating away sooner loses it (one take lost it). The final take waited for 4 events before switching to the sink.
6. Sink on :9793 rather than a DSN in `.env` files only: `SENTRY_DSN=http://mike@127.0.0.1:9793/1` in `backend/.env`, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN=http://mike@127.0.0.1:9793/2` in `frontend/.env.local` (as §2 step 1 says).
7. **Schema-drift clip skipped.** `REMINDER_INTERVAL_MS` in `backend/src/lib/schemaOutOfDate.ts` is a hard-coded constant (60 min) with no env override, so the hourly reminder cannot be shown in a short clip without patching code or faking the clock. Not recorded; `maintenance.test.ts` covers it.
8. Contact support is offered on the `upstream_unavailable` notices (after clips). AGENTS.md says Contact support only for failures the user cannot fix; a transient outage arguably qualifies either way. Noted, not judged.
9. Word add-in, sign-up and MFA flows, and the GoTrue-500 counterexample were not recorded.

## Commands

```bash
git worktree add --detach ~/dev/mike-wt/gif793-main origin/main   # b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif793-pr aa8b8364f
# node_modules (root, backend, frontend) cloned with cp -cR from ~/dev/mike-wt/feature-flags (identical lockfiles on both refs)
# backend/.env = ~/dev/mike/backend/.env with these keys overridden (duplicates removed):
#   PORT=4793 SUPABASE_URL=http://127.0.0.1:54793 FRONTEND_URL=http://127.0.0.1:3793
#   ALLOWED_ORIGINS=http://127.0.0.1:3793,http://localhost:3793 SENTRY_DSN=http://mike@127.0.0.1:9793/1
#   SENTRY_DISABLED=false NODE_ENV=development WORKERS_MODE=none DB_JOBS_ENABLED=false
# frontend/.env.local = NEXT_PUBLIC_SUPABASE_* from ~/dev/mike/frontend/.env.local +
#   API_BASE_URL=NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4793  SENTRY_DSN=NEXT_PUBLIC_SENTRY_DSN=http://mike@127.0.0.1:9793/2
PORT=9793 node scripts/sentry-sink.mjs
PORT=54793 node ~/dev/mike-evidence/793/gotrue-fault-proxy.mjs
(cd backend && npx tsx src/index.ts)        # restarted before each take: restart-backend.sh
(cd frontend && npx next dev -p 3793 -H 127.0.0.1)
curl -s -X DELETE http://127.0.0.1:9793/events          # before each take
curl -s http://127.0.0.1:54793/__fault/on                # during the take, after the page loaded
ffmpeg -ss 4.5 -i before.mp4 -vf "fps=8,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse" -loop 0 pr793-before.gif
ffmpeg -i after.mp4 -filter_complex "[0:v]trim=8:22,setpts=PTS-STARTPTS[x];[0:v]trim=30.5:35,setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[c];[c]fps=8,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse" -loop 0 pr793-after.gif   # cuts the idle hold on the error
ffmpeg -ss 4.5 -i before-navigate.mp4 ... pr793-before-navigate.gif ; ffmpeg -ss 4.5 -i after-navigate.mp4 ... pr793-after-navigate.gif
```

## Temporary data change (restored)

Dev account `public.user_profiles` had `display_name` and `onboarding_version` NULL (login lands on onboarding). Set to 'Ada Lovelace' / 0 for the recordings, set back to NULL afterwards.

## Cleanup

Sink, proxy, every backend and `next dev` started for this stopped by PID (`pids.txt`); Chrome page closed; worktrees `gif793-main` and `gif793-pr` removed; `frontend/AGENTS.md` restored after each `next dev`.

## 2026-11-05 (evening): round-two "after" clips on f1e8dffac

Only the two "after" clips were re-recorded, on PR head **f1e8dffac** (round two: a2f4323ce gate + `operation=auth.session`, f1e8dffac keeps the session on a failed check). The "before" clips are unchanged. Same setup as above (worktree `~/dev/mike-wt/gif793-pr2`, node_modules cloned from feature-flags with identical lockfiles, same env overrides, sink :9793, fault proxy :54793, backend :4793, `next dev` :3793, isolated Chrome DevTools context, Resource Timing overlay). A freshly started backend was used for each take.

| GIF | Ref | Length | Size |
|---|---|---|---|
| `pr793-after-v2.gif` | f1e8dffac | 25.3 s | 754 KB |
| `pr793-after-navigate-v2.gif` | f1e8dffac | 41.4 s | 1.6 MB |

### pr793-after-v2.gif (full page load during the outage): stays on the loader, recovers on its own; **1 event**
The page loads /projects normally, then the fault is switched on and the page is fully loaded again (`navigate_page` to the same URL so the overlay init script is re-installed; a plain `reload` dropped the overlay in take 1). Result: the full-screen loader stays up with one "Couldn't check your session / The server is temporarily unreachable. Please try again shortly." toast (Retry, Contact support). There is no redirect to /login and no second warning. The overlay lists 5 × `/api/auth/session → 503` (the first check plus the 1 s / 2 s / 4 s backoff retries). The proxy logged 5 resets. The fault was turned off after about 7 s. With no click, the next backoff retry opened /projects about 9 s later without a new sign-in, and the toast cleared. Encoding cuts 6 s of the identical loader frames (trim 4–14 s and 20–37 s).
```
project=1 error  AuthRetryableFetchError: Failure in auth.session / http / auth.supabase_unavailable / GET / /auth/session / 503
   operation=auth.session component=http http_status=503 http_method=GET http_route=/auth/session error_kind=auth.supabase_unavailable capture_source=exception occurrence=1
   fingerprint=["upstream-unavailable","http",""]
```
No browser event. Backend log: `[upstream-unavailable] still failing (gotrue:0): 1 request(s) not re-reported since the last line; reported to Sentry 1s ago`, then `[upstream-unavailable] recovered (gotrue:0)`.
Take 1 (`after-v2-take1-nooverlay.mp4`, not published) used the toast's Retry instead of waiting for the backoff. The page opened at once and the toast cleared. The sink showed the same single event.

### pr793-after-navigate-v2.gif (in-app navigation): UI as before, **1 event instead of 5**; a second outage files one new event at once
The fault is switched on with /projects loaded, then a click on the sidebar's "Matter 0001". The project page shows "Couldn't load this project / The server is temporarily unreachable…" with Retry. The sidebar shows "Could not load items. Retry". The user stays signed in. The overlay lists 5 × 503 (`/projects/:id` ×2, `/projects/:id/chats` ×2, `/tabular-review`), and the proxy logged 5 resets. The sink showed **one** event. The fault was then turned off and Retry clicked: the project's Documents view loads. Second outage in the same backend process: the fault goes on, then a click on "Matter 0002" gives the same notice and 5 more 503s, and **one** new event arrives at once (occurrence 2, received at 23:24:22.724Z; the 503 notice is timestamped 23:24:22.730Z). The fault goes off, Retry is clicked, and Matter 0002 loads. Encoding cuts the idle holds (trim 3–23, 29–36, 40–49, 53–61.7 s).
```
23:23:58.416Z project=1 error  AuthRetryableFetchError: Failure in auth.session / http / auth.supabase_unavailable / GET / /projects/:id/chats / 503
   operation=auth.session http_route=/projects/:id/chats occurrence=1 fingerprint=["upstream-unavailable","http",""]
23:24:22.724Z project=1 error  AuthRetryableFetchError: Failure in auth.session / http / auth.supabase_unavailable / GET / /projects/:id/chats / 503
   operation=auth.session http_route=/projects/:id/chats occurrence=2 fingerprint=["upstream-unavailable","http",""]   (second outage, after recovery)
```
No browser events. Backend log (fresh process):
```
[upstream-unavailable] still failing (gotrue:0): 1 request(s) not re-reported since the last line; reported to Sentry 1s ago
[upstream-unavailable] recovered (gotrue:0)
[upstream-unavailable] still failing (gotrue:0): 1 request(s) not re-reported since the last line; reported to Sentry 0s ago
[upstream-unavailable] recovered (gotrue:0)
```
Raw rows: `after-v2-sink-events.jsonl`, `after-navigate-v2-sink-events.jsonl`. Logs: `v2-backend3.log` (reload take), `v2-backend4.log` (navigate take), `v2-proxy.log`.

### Observations
1. The "still failing" line counts only the suppressed requests since its own last line, and it is printed at most once a minute. Each outage had 4 suppressed requests, but the line says "1 request(s)" because it fires on the first repeat. The other 3 would be counted in a later line, which never printed because the outage ended within a minute. Expected from the design. The wording can read as "only 1 repeat".
2. The event's `http_route` names whichever request tripped first (`/projects/:id/chats` here, not `/projects/:id`). This is as described in 793-round2.md.
3. The Next.js dev-tools badge ("1 Issue") in the navigate clip is the dev-only overlay for the console line `[project assistant] failed to load MikeApiError: The server is temporarily unreachable`. It is not a Sentry event, and production builds do not show it.
4. The overlay lost its init script on a `reload` (take 1). Take 2 used a full `navigate_page` to the same URL. For the app this is the same full page load.

### Cleanup (v2)
Sink 26999, proxy 27000, backends 27001 → 28867 → 30718 → 32902, and `next dev` 27002 were all stopped by PID. Ports 3793/4793/9793/54793 are free. The Chrome page is closed. Worktree `gif793-pr2` was removed. `frontend/AGENTS.md` was restored after `next dev`. The dev account's `display_name` / `onboarding_version` were set to 'Ada Lovelace' / 0 for the takes and are back to NULL.

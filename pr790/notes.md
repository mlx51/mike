# PR #790 evidence: profile load when `/user/profile` omits `apiKeyStatus`

Recorded 2026-11-05 with the Chrome DevTools MCP screencast (isolated browser context, 2880x1454 viewport), converted at 8 fps / 1280 px.
Real local stack: Supabase CLI stack (:54321/:54322), a real backend from origin/main on :4790, `next dev` on :3790, logged in as the local dev account.

## Fault injection

`strip-proxy.mjs` (in this folder, not committed to the repo) sits between `next dev` and the backend: `API_BASE_URL=http://127.0.0.1:4791` -> proxy -> backend :4790.
It pipes everything through unchanged except JSON responses for `/user/profile`, where it deletes `apiKeyStatus` (imitates an older or forked backend).
Its log shows `[strip] GET /user/profile 200: removed apiKeyStatus` for each load. `STRIP=0` turns it into a plain pass-through (used for the control).
The backend code was not patched.

## pr790-before.gif (origin/main b91d1bdf4), 15 s

1. Reloads `/settings`.
2. The "Couldn't load your profile / Something went wrong. Try again, and contact support if it keeps happening." notice appears with "Contact support" and "Retry". Display Name is empty although the server sent "Ada Lovelace"; the avatar falls back to the email.
3. Switches to the sink's events page (`http://localhost:9999/`): 1 event.

Console (warn): `[profile] fetch failed after retry; API key availability is unknown and fails open TypeError: Cannot read properties of undefined (reading 'claude')`, then `[user-error] Couldn't load your profile TypeError: ...`.

Sink event during the recording (project 2 = web app via the `/monitoring` tunnel):

```
level=error  TypeError: Failure in notify @ _next/static/chunks/_1scz0d-a7wv9r._.js:3190
  service=mike-frontend runtime=browser build_mode=development diagnostics_version=2 install=community component=notify capture_source=exception occurrence=1
```

Two identical events were also filed before the recording (the login page's profile load and the first `/settings` load); the sink was cleared before recording. Matches Sentry MIKE-FRONTEND-4H.

## pr790-after.gif (PR head 024f64a72), 19 s

1. Same proxy, sink cleared with `DELETE /events`. Reloads `/settings`: Display Name "Ada Lovelace", avatar "Ada Lovelace", no notice.
2. Clicks Assistant: "Hi, Ada Lovelace". Opens the composer's model picker: Anthropic, Google, OpenAI and **Mistral AI** groups; expands Mistral AI (Large 4 Preview, Medium 3.5, Small 4), which the server reports as having no key. That is the fail-open picker (`apiKeysDegraded=true`).
3. Switches to the sink's events page: **0 events**. No console warnings from the profile load.

Control (not recorded, same PR head, proxy `STRIP=0` so `apiKeyStatus` is present): the picker shows only Anthropic, Google and OpenAI (the providers with env keys); the Mistral AI group is hidden. So with key status the pickers gate on keys as before, and without it they fail open.

## Sink events

- Before (main): 3 `TypeError: Failure in notify` events in total (1 during the recording).
- After (PR head): 0 events across the control and the recording.
- Unrelated: one backend event (project 1) at boot, `Error: Failure in memory.consolidate / dbq / memory.consolidation_failed / invalid_api_key`, from a queued memory job hitting the dead provider keys in backend/.env. Cleared before both recordings. Full terminal log: `sink-terminal-full.log`.

## Commands

```bash
git worktree add --detach ~/dev/mike-wt/gif790-main origin/main      # b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif790-pr 024f64a728e6777502196383343e69902e3c6072
# node_modules cloned (cp -cR) from sibling worktrees whose lockfiles match:
#   main: ~/dev/mike-wt/feature-flags (root, frontend, backend); PR: ~/dev/mike-wt/algo (root, frontend)
PORT=9999 node scripts/sentry-sink.mjs
cp ~/dev/mike/backend/.env backend/.env   # in gif790-main
(cd backend && PORT=4790 FRONTEND_URL=http://127.0.0.1:3790 ALLOWED_ORIGINS=http://localhost:3790 \
  SENTRY_DSN=http://mike@localhost:9999/1 npx tsx src/index.ts)          # SENTRY_DISABLED unset
PORT=4791 UPSTREAM=http://127.0.0.1:4790 node strip-proxy.mjs
# frontend/.env.local = Supabase lines from ~/dev/mike/frontend/.env.local plus
#   API_BASE_URL=http://127.0.0.1:4791  NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4791
#   SENTRY_DSN=http://mike@localhost:9999/2  NEXT_PUBLIC_SENTRY_DSN=http://mike@localhost:9999/2
(cd frontend && npx next dev -p 3790 -H 127.0.0.1)   # main first, then stopped; PR on the same port
curl -X DELETE http://localhost:9999/events
ffmpeg -ss 1.2 -i before.mp4 -vf "fps=8,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse" -loop 0 pr790-before.gif
ffmpeg -ss 2.6 -i after.mp4  -vf "...same..." -loop 0 pr790-after.gif
```

## Temporary data changes (restored)

The dev account had `display_name = NULL` and `onboarding_version = NULL` (onboarding not done). For a visible before/after:
- `display_name` was set to "Ada Lovelace" (PATCH /user/profile on the backend directly) before the before-recording;
- `onboarding_version` was set to 0 (legacy-exempt) before the after-recording (see below).
Both were set back to NULL in `public.user_profiles` afterwards.

## Differences from the review comment (comments/790.md sections 2-3)

- Fault injection: a pass-through proxy in front of a real origin/main backend, not the stub upstream on :4121 that answers `[]` for every other path. Login, projects and models are real.
- Sink on :9999 (`scripts/sentry-sink.mjs` default), not :9121; DSNs set in the worktree's `frontend/.env.local` as the comment says.
- The notice also appears on the **login** page right after signing in (the profile loads there too), so main filed 2 events before `/settings` was even opened. Each profile load files one event.
- On main the failed load swaps in the fallback profile, which counts as onboarded, so a user with unfinished onboarding (`onboarding_version` NULL) lands on `/settings` anyway. With the fix the real profile loads and the same user is redirected to onboarding step 1 ("Tell us about you", Name prefilled "Ada Lovelace"). This is correct behaviour, not a regression, but it means the bug on main also skipped onboarding. For the after-recording the account was marked legacy-exempt so `/settings` could be shown.
- The composer button's description reads "API key missing for selected model" on both the degraded and the control load. No model was selected (`lastSelectedChatModel` null), so this is the empty-selection state, not key gating. The fail-open evidence is the Mistral AI group being listed only in the degraded case.
- The console line on main is the same text as the comment, followed by a second warning `[user-error] Couldn't load your profile TypeError: ...`.

## 2026-11-05: pr790-after-v2.gif (fixed PR head 36e9a0283), 43 s

Re-recorded only the "after" clip after the review fixes (head 36e9a0283, was 024f64a72); `pr790-before.gif` is unchanged.
Same harness as above with one difference: the earlier main/PR worktrees were gone, so the backend ran from the PR worktree `~/dev/mike-wt/gif790-v2` (the PR touches only `frontend/`, so the backend is the same as its merge base). node_modules cloned from `~/dev/mike-wt/algo` (all three lockfiles match). Same proxy (`strip-proxy.mjs`, STRIP on), sink :9999, backend :4790, proxy :4791, `next dev` :3790, dev account; `display_name` "Ada Lovelace" and `onboarding_version` 0 set for the clip and restored to NULL afterwards.
Raw screencast `after-v2.mp4` (54 s); the GIF cuts two idle stretches (picker hold, settings hold) with trim+concat at 8 fps / 1280 px.

1. Sink cleared. Reloads `/settings`: Display Name "Ada Lovelace", avatar "Ada Lovelace", no notice.
2. Clicks Assistant: "Hi, Ada Lovelace". Opens the model picker: Anthropic, Google, OpenAI and **Mistral AI**; expands Mistral AI (Large 4 Preview, Medium 3.5, Small 4). Fail-open picker, as before.
3. Sink page: **1 event**.
4. Loads `/settings` again (a new page load): page identical, no notice.
5. Sink page: **2 events**.

Sink events (both project 2, the web app):

```
level=warning  Error: Failure in profile / missing_api_key_status @ _next/static/chunks/_1scz0d-a7wv9r._.js:2243
  service=mike-frontend runtime=browser build_mode=development diagnostics_version=2 install=community component=profile error_kind=missing_api_key_status capture_source=exception occurrence=1
```

received 23:29:44.712Z (first reload) and 23:30:19.760Z (second load). The raw events carry only the tags, a one-frame stack and the fingerprint; no `extra`, `contexts`, user or request (no profile payload). Proxy log: one `[strip] GET /user/profile 200: removed apiKeyStatus` per load. Client-side navigation to Assistant did not file another event (once per page load).

Before recording (not in the clip): the login page's profile load and the first `/settings` load filed one warning each, and an unrecorded reload filed one more; the sink was cleared after each. Unrelated backend noise at boot: 4 `AppError: Failure in audit.write / dbq / audit.write_failed / 23503` warnings (project 1) from queued `audit.chat_turn` jobs, cleared before recording. Full sink terminal log: `sink-terminal-v2.log`.

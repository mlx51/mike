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

# PR #782 evidence: development builds stop reporting to the Mike project by default

Recorded 2026-11-05 with vhs (terminal recording, zsh, 1400 px wide), converted to GIF at 8 fps with a 64-colour palette.
Real processes: the backend from source (`npm run dev` = `tsx watch src/index.ts`) and `next dev`, both from worktrees, against the local Supabase CLI stack (:54321). Sink: `node scripts/sentry-sink.mjs` on :9999.

- `pr782-before.gif`: origin/main b91d1bdf4, 22 s
- `pr782-after.gif`: PR head b6513142a, 23 s (recorded at 28 s, played back at 1.2x)

## How the built-in Mike DSN was pointed at the sink

The fallback DSN is hard-coded (`MIKE_SENTRY_DSN.backend` in `backend/src/lib/observability/sentry.ts`, the frontend copy in `packages/client`), and no environment variable overrides it; comments/782.md names none. So both runs (main and PR, backend and `next dev`) were started with
`NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"`.
That preload (in this folder) rewrites any `https.request` to `*.sentry.io` into a plain-HTTP request to `127.0.0.1:9999` with the same path, logs `[redirect] <host><path> -> sink`, wraps `fetch` the same way, and throws on any direct TLS connection to `*.sentry.io` as a safety net. Nothing reached the real Mike Sentry project. The app code was not patched.

## pr782-before.gif (origin/main b91d1bdf4)

1. `backend/.env` has `NODE_ENV=development`, `SENTRY_DISABLED=false` (as `backend/.env.example` ships) and no `SENTRY_DSN`.
2. `MANIFEST_SIGNING_KEY=not-hex npm run dev` logs `[sentry] enabled for api → Mike project Sentry (community install, release mike@0.0.0)`, then `Mike backend failed to start: Error: MANIFEST_SIGNING_KEY must be a 32-byte hex string ...`, then `[redirect] o4512288166510592.ingest.us.sentry.io/api/4512288204718080/envelope/ -> http://127.0.0.1:9999`.
3. The sink has the event, posted to project **4512288204718080** (the Mike backend project id from the built-in DSN):
   ```
   project=4512288204718080 environment=self-hosted
   Error: Failure in boot / manifest-key / signing_key_invalid
   tags: service=mike-backend role=api install=community build_mode=development diagnostics_version=2 component=boot stage=manifest-key failure_code=signing_key_invalid capture_source=exception occurrence=1
   ```
4. `next dev` logged `[sentry] web app reports → Mike project Sentry (community default), browser included. ...`; `GET /monitoring` → `{"reports":"default",...}`.

## pr782-after.gif (PR head b6513142a)

1. Same `.env`, same preload, sink cleared.
2. `MANIFEST_SIGNING_KEY=not-hex npm run dev` logs `[sentry] disabled for api (development build; set SENTRY_DSN to report to your own project)`, then the same boot failure. No `[redirect]` line.
3. `curl localhost:9999/events | jq length` → `0`.
4. `SENTRY_DSN=http://mike@localhost:9999/1 MANIFEST_SIGNING_KEY=not-hex npm run dev` logs `[sentry] enabled for api (environment development, release mike@0.0.0)`, then the boot failure. The sink has:
   ```
   project=1 environment=development
   Error: Failure in boot / manifest-key / signing_key_invalid
   tags: service=mike-backend role=api install=community build_mode=development diagnostics_version=2 component=boot stage=manifest-key failure_code=signing_key_invalid capture_source=exception occurrence=1
   ```
   `build_mode=development` here comes from the entry file (`tsx` running `src/index.ts`), not NODE_ENV.
5. `next dev` logged `[sentry] web app reports: off (development build; set SENTRY_DSN to report to your own project), browser included`; `GET /monitoring` → `{"reports":"development",...}`.

Raw sink rows: `before-sink-events.jsonl`, `after-sink-events.jsonl`. `next dev` logs: `before-frontend.log`, `after-frontend.log`.

## Commands

```bash
git worktree add --detach ~/dev/mike-wt/gif782-main origin/main     # b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif782-pr  b6513142a
# node_modules (root, backend, frontend) cloned with cp -cR from worktrees with identical lockfiles:
#   main <- ~/dev/mike-wt/feature-flags, PR <- ~/dev/mike-wt/algo
cp ~/dev/mike/backend/.env backend/.env      # then appended, in both worktrees:
#   PORT=4782 NODE_ENV=development SENTRY_DISABLED=false WORKERS_MODE=none DB_JOBS_ENABLED=false FRONTEND_URL=http://127.0.0.1:3782
# frontend/.env.local = NEXT_PUBLIC_SUPABASE_* from ~/dev/mike/frontend/.env.local + API_BASE_URL/NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4782 (no Sentry vars)
PORT=9999 node scripts/sentry-sink.mjs
export NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"
(cd frontend && npx next dev -p 3782 -H 127.0.0.1)          # main first, then PR on the same port
vhs before.tape     # in main's backend/ (setup-main.sh)
vhs after.tape      # in the PR's backend/ (setup-pr.sh)
ffmpeg -i before.mp4 -vf "fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr782-before.gif
ffmpeg -i after.mp4  -vf "setpts=PTS/1.2,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr782-after.gif
```

`WORKERS_MODE=none` and `DB_JOBS_ENABLED=false` keep these backends from claiming queue jobs on the shared local database (other agents' work) and from filing job failures (dead provider keys) during the recording.

## How reality differed from comments/782.md

- **The named trigger does not produce an event, on main or on the PR head.** `GET /observability/sentry-test` with `SENTRY_ENABLE_TEST_ROUTE=true` and the sink DSN answers 500 and logs `[http/internal-error]`, but the sink stays empty. Traced on main with a `beforeSend` wrapper: Sentry's Express auto-instrumentation captures the thrown error first (`mechanism auto.http.express, handled:false`), which marks the object as captured; `sendInternalError` → `reportError` then calls `captureException` on the same object and the SDK skips it as already captured; `scrubEvent` drops the auto-captured copy as "already reported" (`reportedErrors`), and drops the `[http/internal-error]` console-bridge copy too. Net: zero events. A standalone `reportError` call under tsx does reach the sink, so the transport is fine. This is pre-existing and unrelated to #782, but the comment's step 5, the PR's docs on the test route, and anyone using the route to "confirm the DSN works" are affected. PR-head run log: `sentry-test-route-pr-head.log`. Worth its own issue.
- Trigger used instead: a boot failure with `MANIFEST_SIGNING_KEY=not-hex` (`Failure in boot / manifest-key / signing_key_invalid`), which `failBoot` reports and flushes. Same shape as MIKE-BACKEND-2.
- The comment's step 5 uses `SENTRY_DSN` for the "before"; that shows the event's shape but not that a checkout with no DSN reports to the Mike project. The before GIF shows the actual default path (no DSN, built-in DSN redirected to the sink, project id 4512288204718080).
- `~/dev/mike/backend/.env` has no `NODE_ENV`; on main the `build_mode` tag is raw `NODE_ENV`, so a checkout without it would tag `build_mode` as unset rather than `development`. `NODE_ENV=development` was set as `.env.example` does. On the PR head `build_mode` is derived from the entry file, so it is `development` either way.
- Word add-in (step 4) was not recorded.
- The counterexample (compiled `node dist/index.js` still reports as `self-hosted`) was not recorded.

## Cleanup

All processes started for this (sink, two `next dev`, backends) stopped; Chrome page closed; worktrees `gif782-main` and `gif782-pr` removed.

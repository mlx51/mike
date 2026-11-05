# PR #791 evidence: one boot report for a missing encryption secret, silent port clash for source runs only

Recorded 2026-11-05 with vhs (terminal only, zsh, 1500 px wide), converted to GIF at 8 fps with a 64-colour palette.
Real processes: the backend from source (`npm run dev` = `tsx watch src/index.ts`) and compiled (`node dist/index.js` after `npm run build`), from two worktrees, against the shared local Supabase CLI stack (:54321 / :54322). Sink: `scripts/sentry-sink.mjs` on :9791.

- `pr791-before.gif`: origin/main b91d1bdf4, 23 s (recorded 46 s, played back at 2.0x), 304 KB
- `pr791-after.gif`: PR head 3c9ac0574, 23 s (recorded 41 s, played back at 1.8x), 344 KB

Both GIFs run the same script: (1) start the API with the secret unset, read stored keys 3 times, show the log and the sink; (2) start a second API on the same port from source, show the sink; then the same clash compiled, show the sink.

## Setup

- Data: **nothing inserted or changed.** The shared DB already had encrypted rows: `user_api_keys` 2 (users `onb-749r1a@mike.local` / claude, `sweep787@mike.local` / openrouter), `org_api_keys` 1, all connector/Google token tables 0. So there was nothing to revert.
- Bearer token: GoTrue admin `generate_link` (magiclink) + `/auth/v1/verify` for `onb-749r1a@mike.local`. No password or profile change; it only adds a GoTrue session row for that test user. (`sweep787` has `mfa_on_login=true`, so its token got 403 `[auth/mfa] login verification required`.)
- `backend/.env` in both worktrees = `~/dev/mike/backend/.env` minus `USER_API_KEYS_ENCRYPTION_SECRET` (line removed, not set empty), plus
  `PORT=4791 FRONTEND_URL=http://127.0.0.1:3791 NODE_ENV=development SENTRY_DISABLED=false SENTRY_DSN=http://mike@127.0.0.1:9791/1 WORKERS_MODE=none DB_JOBS_ENABLED=false`.
  `MCP_CONNECTORS_ENCRYPTION_SECRET` is unset, so the PR's check also covered the connector columns (all empty).
- Safety net: `NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"` with `SINK_PORT=9791`. No `[redirect]` line was logged in either run (every event used the explicit sink DSN, `project=1`); nothing reached a real Sentry project.

```bash
git worktree add --detach ~/dev/mike-wt/gif791-main b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif791-pr  3c9ac0574
# node_modules (root + backend) cloned with cp -cR from worktrees with identical lockfiles:
#   main <- ~/dev/mike-wt/feature-flags, PR <- ~/dev/mike-wt/algo
npm run build --prefix backend          # in each worktree (tsc, ~30 s each)
PORT=9791 node scripts/sentry-sink.mjs > ~/dev/mike-evidence/791/sink.log
vhs before.tape    # sources setup-main.sh (cd backend, NODE_OPTIONS, $T token, ev/cnt/clr/reads helpers)
vhs after.tape     # sources setup-pr.sh
ffmpeg -i pr791-before.mp4 -vf "setpts=PTS/2.0,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr791-before.gif
ffmpeg -i pr791-after.mp4  -vf "setpts=PTS/1.8,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr791-after.gif
```

Commands shown in each GIF (in `backend/`):
```bash
npm run dev < /dev/null > $E/pr791-<side>-api.log 2>&1 &!     # first API on :4791
until curl -s 127.0.0.1:4791/health >/dev/null; do sleep 0.3; done
reads      # 3x GET /models/configured with the key owner's bearer token
npm run dev 2>&1 | grep --line-buffered -E 'start|EADDRINUSE' | head -2   # second API, source; Ctrl+C after 14 s
node dist/index.js 2>&1 | grep -E 'start|EADDRINUSE' | head -2            # second API, compiled
```

## pr791-before.gif (origin/main b91d1bdf4)

1. Boot: `[sentry] enabled for api (environment self-hosted, release mike@0.0.0)`, `Mike backend running on port 4791`. No startup line about the secret, no boot event.
2. Three reads → `200 200 200`; the log has three `[user-api-keys] Error: USER_API_KEYS_ENCRYPTION_SECRET is not configured` (with stack, `detail: 'failed to decrypt stored key', provider: 'claude'`). Sink, two events (occurrences 1 and 2; the 3rd is power-of-two throttled):
   ```
   level=error Error: Failure in application @ backend/src/lib/providerCredentials/store.ts:189
     service=mike-backend role=api install=community build_mode=development diagnostics_version=2 capture_source=console occurrence=1
   level=error Error: Failure in application @ backend/src/lib/providerCredentials/store.ts:189
     ... capture_source=console occurrence=2
   ```
   No kind, no field name: 7E's shape.
3. Second API from source: `Mike backend failed to start: Error: listen EADDRINUSE: address already in use :::4791`. Sink, 1 event:
   ```
   level=fatal Error: Failure in boot / listen / EADDRINUSE @ node:net:1941
     ... build_mode=development component=boot stage=listen failure_code=EADDRINUSE capture_source=exception occurrence=1
   ```
4. Second API compiled (`node dist/index.js`, same `.env` with `NODE_ENV=development`): same line, same single fatal event.

## pr791-after.gif (PR head 3c9ac0574)

1. Boot: same `[sentry]` and `running` lines, then `[startup] USER_API_KEYS_ENCRYPTION_SECRET is not configured, but the database holds API keys or connector credentials encrypted with it. They are ignored until the secret is restored (see backend/.env.example).`
2. Three reads → `200 200 200`; the log has exactly one `[user-api-keys] USER_API_KEYS_ENCRYPTION_SECRET is not configured; stored API keys are ignored`. Sink, **one** event, sent at boot, none from the reads:
   ```
   level=error AppError: Failure in boot / encryption-secret / config.encryption_secret_missing / configuration_invalid @ backend/src/lib/providerCredentials/secretCheck.ts:105
     service=mike-backend role=api install=community build_mode=development diagnostics_version=2 component=boot stage=encryption-secret configuration_fields=USER_API_KEYS_ENCRYPTION_SECRET error_kind=config.encryption_secret_missing failure_code=configuration_invalid capture_source=exception occurrence=1
   ```
3. Second API from source: `Mike backend could not start: port 4791 is already in use (EADDRINUSE). Stop the other process or set PORT.` Sink: `sink events: 0`.
4. Second API compiled (`node dist/index.js`, `NODE_ENV=development`): `Mike backend failed to start: Error: listen EADDRINUSE ...`, sink has 1 event, the same `level=fatal Error: Failure in boot / listen / EADDRINUSE` with `component=boot stage=listen failure_code=EADDRINUSE`. The compose-style install keeps the signal.

Raw sink output for every run (dry runs and final takes): `sink.log`. Backend logs of the recorded first API: `pr791-before-api.log`, `pr791-after-api.log`. Unedited recordings: `pr791-before.mp4`, `pr791-after.mp4`.

## How reality differed from comments/791.md

- **Head.** Section 3 names d45e16266; this was recorded on the fixed head 3c9ac0574. Section 3 step 4 says the clash is silent "in a development build" and fatal "under `NODE_ENV=production`". At 3c9ac0574 the rule is the entry file (`lib/buildMode.ts` `isDevelopmentBuild(argv)`), not NODE_ENV: a compiled run under `NODE_ENV=development` still sends the fatal event (shown in the after GIF). This matches fixes/791.md, not the comment's wording.
- **Stored key.** Step 2 says to save a provider key in Settings first. Not needed: the shared DB already had 2 `user_api_keys` rows and 1 `org_api_keys` row. Nothing inserted, nothing reverted.
- **Secret unset vs empty.** Step 2 sets `USER_API_KEYS_ENCRYPTION_SECRET=` (empty). I removed the line. Both are falsy for the `!process.env...` / `if (env.USER_API_KEYS_ENCRYPTION_SECRET)` checks, so behaviour is the same.
- **`build_mode=development` on the compiled run.** On both heads the `build_mode` tag is still NODE_ENV-derived, so the compiled clash is tagged `build_mode=development`, and `environment` is `self-hosted` in both. Only #782 moves `build_mode` to the entry-file rule. Not a #791 problem, but a reader of the after GIF may notice a "development" tag on the event that is supposed to prove a compiled install still reports.
- **Second source API on main is slow to fail.** The second `tsx` boot took over 10 s in one take (nothing printed before Ctrl+C, so that take was discarded); the final takes wait 14 s. On the PR head, the second source run exits before its own `reportMissingEncryptionSecret` query finishes, so it sends no encryption-secret event either (0 events). With a slower listen failure it could send one; not seen.
- **`tsx watch` keeps running after the exit(1)** on both heads (it waits for file changes), hence the Ctrl+C in the GIF.
- **Not recorded:** the refresh race (step 4 / 8D), the warnings (65 / 2H / 5F), the AI SDK dedupe, and the MCP-connector fallback rows (no such rows in the DB). The comment says these are unit-test-only or out of scope for this brief.
- **Cosmetic:** the after GIF shows one stray typeahead echo line (`grep -E '^\[(sentry|startup|user%`) just before the real `grep` command; vhs typed the next line while `until` was still looping. It has no effect on the output.

## Cleanup

All processes I started (sink PID 15246, both first APIs, second source runs, compiled runs) were stopped by PID; nothing listens on :4791 or :9791. Worktrees `gif791-main` and `gif791-pr` removed. The token file in the scratchpad was deleted.

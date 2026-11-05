# PR #778 evidence: a Redis outage files one queue.connection_lost warning instead of console-bridge errors

Recorded 2026-11-05 with vhs (terminal only, zsh, 1500 px wide), converted to GIF at 8 fps with a 64-colour palette, played back at 1.2x.
Real processes: the backend from source (`node --import tsx src/index.ts`, default `WORKERS_MODE=thread`, so the BullMQ Workers run in the jobs worker thread exactly as in production) from two worktrees, against the shared local Supabase CLI stack (:54321 / :54322). Redis: none. `REDIS_URL` points at 127.0.0.1:6378, where nothing listens, so every connect is `ECONNREFUSED` (the MIKE-BACKEND-42 errno). Sink: `scripts/sentry-sink.mjs` on :9778.

- `pr778-before.gif`: origin/main b91d1bdf4, 22 s (recorded 26.4 s, 1.2x), 241 KB
- `pr778-after.gif`: PR head e74b25d75, 22 s (recorded 26.5 s, 1.2x), 295 KB

Both GIFs run the same script: start the API with the queue on the closed port; at 10 s after boot show the worker lines, the count of raw `Error: connect ECONNREFUSED` lines in the log, the log tail, and the sink; then a labelled cut ("waiting until 65 s after boot (cut)", vhs `Hide`) and the same views at 65 s, so the 60 s summary line on the PR head is in frame.

## Setup

```bash
git worktree add --detach ~/dev/mike-wt/gif778-main b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif778-pr  e74b25d75
# node_modules (root + backend) cloned with cp -cR from worktrees with identical lockfiles:
#   main <- ~/dev/mike-wt/feature-flags, PR <- ~/dev/mike-wt/algo
# backend/.env in both = ~/dev/mike/backend/.env minus PORT, plus:
#   PORT=4778 FRONTEND_URL=http://127.0.0.1:3778 NODE_ENV=development SENTRY_DISABLED=false
#   SENTRY_DSN=http://mike@127.0.0.1:9778/1
#   REDIS_URL=redis://127.0.0.1:6378 ASYNC_DOCUMENT_CONVERSION=true ASYNC_TABULAR_EXTRACTION=true
#   DB_JOBS_ENABLED=false UPLOAD_PROCESSING_CONCURRENCY=1
PORT=9778 node scripts/sentry-sink.mjs > ~/dev/mike-evidence/778/sink.log
vhs main.tape      # sources setup-main.sh (cd backend, NODE_OPTIONS preload, ev/raw/waitboot helpers)
vhs pr.tape        # sources setup-pr.sh
ffmpeg -i pr778-before.mp4 -vf "setpts=PTS/1.2,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr778-before.gif
ffmpeg -i pr778-after.mp4  -vf "setpts=PTS/1.2,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr778-after.gif
```

- `REDIS_URL` set makes `queueDriver()` return `redis`; the two `ASYNC_*` flags enable the conversion and extraction Workers on top of app-jobs, so all three BullMQ Workers start (`[workers] ... worker started` x3 in both GIFs).
- `DB_JOBS_ENABLED=false` keeps the API from claiming db_jobs rows on the shared database. `UPLOAD_PROCESSING_CONCURRENCY=1`: the uploads thread still polls; `upload_processing_jobs` had 0 non-completed rows before the runs, so nothing was claimed.
- The stale sweep runs 30 s after boot on both heads (not configurable). It found 2 `generating` cells, could not look up their extraction jobs (Redis down), and treated them as live (fail-safe). **No row was changed:** no `[stale-sweep] flipped` line in either log.
- Safety net: `NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"` with `SINK_PORT=9778`. No `[redirect]` line in either API log; every event arrived as `project=1` from the explicit sink DSN.

## pr778-before.gif (origin/main b91d1bdf4)

At 10 s: 42 raw `Error: connect ECONNREFUSED 127.0.0.1:6378` blocks in the log (message, two `node:net` frames, errno/code/syscall/address/port), no `[queue]` line. Sink, 1 event:
```
error  Error: Failure in application / ECONNREFUSED @ node:net:1638
  service=mike-backend role=worker-thread install=community build_mode=development diagnostics_version=2 failure_code=ECONNREFUSED capture_source=console occurrence=1
```
At 65 s: 132 raw blocks in the frame (155 by the time the process was stopped). Sink, 3 events: the one above, plus two from the stale sweep (see "Not fixed by this PR"):
```
error  Error: Failure in maintenance.cells / stale-sweep / db.query_failed @ backend/src/lib/queue/connection.ts:153
  operation=maintenance.cells ... component=stale-sweep error_kind=db.query_failed capture_source=exception occurrence=1
error  Error: Failure in maintenance.cells / application / ECONNREFUSED @ node:net:1638
  operation=maintenance.cells ... failure_code=ECONNREFUSED capture_source=console occurrence=1
```

## pr778-after.gif (PR head e74b25d75)

At 10 s: 0 raw blocks. The log has exactly one `[queue] redis consumer error Error:ECONNREFUSED`. Sink, 1 event:
```
warning  Error: Failure in queue / connection / queue.connection_lost / ECONNREFUSED @ node:net:1638
  service=mike-backend role=worker-thread install=community build_mode=development diagnostics_version=2 component=queue stage=connection error_kind=queue.connection_lost failure_code=ECONNREFUSED capture_source=exception occurrence=1
```
At 65 s: `[queue] redis consumer still failing (Error:ECONNREFUSED): 73 consecutive failures, 72 not re-reported since the last line; next attempt in 0s`. Still one `queue.connection_lost` event. 14 raw blocks in the frame (17 at stop), all after the 30 s stale sweep, and the same two stale-sweep events as on main (the console one reaches `occurrence=2` here). Sink total 4.

Raw sink rows: `before-sink-events.json`, `after-sink-events.json`; full sink output: `sink.log`. API logs: `pr778-main-api.log`, `pr778-pr-api.log`. Unedited recordings: `pr778-before.mp4`, `pr778-after.mp4`. Tapes and setup scripts are in this folder.

## How reality differed from comments/778.md

- **Head.** Section 3 names b5ff3562e; recorded on the fixed head e74b25d75 per fixes/778.md.
- **No "burst across several groups" on main.** The brief and section 2 step 4 expect one sink event per logged line. On main the log floods (42 blocks in 10 s, ~155 in 70 s) but the sink got **one** Worker event in 65 s. Likely cause: the Sentry Node SDK's default `dedupeIntegration` drops an event identical to the previous one, and the three Workers print identical errors back to back. The occurrence budget would have let occurrence 2 through, so the budget is not what dropped them. In production the 7–13 events per issue come from interleaving with other events over longer outages. Main's flood is still the defect; it just costs fewer events per minute than the comment implies.
- **No `[ioredis] Unhandled error event` lines on main.** Section 2 step 4 says each reconnect logs that prefix. In this run none appeared (0 matches). BullMQ attaches its own listener to the shared consumer connection and forwards errors to each Worker; a Worker without an `error` listener throws inside `QueueBase.emit`, which falls back to `console.error(err)` (`bullmq/dist/cjs/classes/queue-base.js:79-91`). So the lines are bare `Error: connect ECONNREFUSED ...` blocks, and the event's culprit is `node:net:1638`. The ioredis prefix would only appear on a connection BullMQ never wrapped.
- **Title has an `Error:` prefix.** Section 3 step 2 gives `Failure in queue / connection / queue.connection_lost / ENOTFOUND`; the sink shows `Error: Failure in queue / connection / queue.connection_lost / ECONNREFUSED` (same shape as every other title in the sink). Errno is ECONNREFUSED here because the repro is the bare-metal closed port; the ENOTFOUND/ETIMEDOUT variants need the compose stack (not allowed on this machine).
- **Summary line wording.** Section 3 step 2 says `[queue] redis consumer still failing (…)` at most once per 60 s: matches, with `73 consecutive failures` in the first minute. 73 is the number of distinct failed attempts across the shared connection and the Workers' own blocking clients after the WeakSet dedupe, so it is higher than the shared connection's reconnect count alone.
- **Not fixed by this PR (both heads): the stale sweep's producer-side Queue.** From the 30 s sweep on, the extraction `Queue` built by `getExtractionQueue()` (used by `tabular.maintenance.ts` `liveExtractionJobs`) has no `error` listener, so it prints the same raw `Error: connect ECONNREFUSED` blocks through BullMQ's `console.error` fallback, and the console bridge files them as `Error: Failure in maintenance.cells / application / ECONNREFUSED`, `capture_source=console`, culprit `node:net`. That has the MIKE-BACKEND-42 title shape (plus `operation=maintenance.cells`) and is still filed at error level on the PR head (occurrence 1 and 2 in 65 s). The raw-block attribution is an inference from timing (0 blocks at 10 s on the PR head, first blocks after the 30 s sweep, matching the new console event); it was not traced frame by frame. Worth a follow-up, or `watchQueueErrors` on the producer Queues, before claiming that 42 closes.
- **`stale-sweep / db.query_failed`** (one per sweep, `exception`, error level) appears on both heads; it is the sweep's explicit report and unrelated to #778.
- **Lock-loss case not recorded.** There is no in-process Redis stand-in in the PR's fixtures (no ioredis-mock; `backend/package.json` has only `ioredis`). The lock-loss / non-connection path (`queue.worker_error`, level error, stage=worker, one report per message template, job id stripped) is covered by the real-Worker test `backend/src/lib/queue/__tests__/workerErrors.test.ts` (real BullMQ Worker on closed port 6398, emits BullMQ's lock messages for jobs 101/102/103, asserts 2 `queue.worker_error` reports at error/stage=worker and still 1 `queue.connection_lost`).
- **Recovery line not recorded.** Without a real Redis there is no `ready` event, so `recovered after N` is not shown; it is covered by the unit test that fixes/778.md cites ("recovered after 9" vs 3).
- **6Q (`runner.ts`).** Not reproducible here: `DB_JOBS_ENABLED=false` was required to keep off shared job rows, so the dbq runner never ran.

## Cleanup

All processes I started were stopped by PID: the sink (52615), the two dry-run APIs (52664 tree, 53963 tree), and the recorded APIs (57168, 58344, plus their esbuild children via `pkill -P <pid>`). Nothing listens on :4778 or :9778. Worktrees `gif778-main` and `gif778-pr` removed.

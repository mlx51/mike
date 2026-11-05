# PR #781 evidence: Node engines floor (>=22.19.0) now refuses installs and starts

Recorded 2026-11-05 with vhs (terminal only, zsh, 1500x560), converted to GIF at 8 fps with a 64-colour palette. No browser. The backend ran from source (`npm run dev` = `tsx watch src/index.ts`) in two worktrees. Sink: `scripts/sentry-sink.mjs` on :9781.

- `pr781-before.gif`: origin/main b91d1bdf4, 23.6 s (recorded 29.6 s, played back at 1.25x), 154 KB
- `pr781-after.gif`: PR head f8278e4ff, 23.3 s (recorded 37.1 s, played back at 1.6x), 221 KB

## How Node 22.14.0 was obtained

No nvm, fnm or volta on this machine, and no `node` package in the npx cache, so I could not see how the fix agent got its 22.14.0. I downloaded the official tarball into its own folder (nothing installed system-wide) and checked its SHA-256 against nodejs.org's SHASUMS256.txt:

```bash
cd ~/dev/mike-evidence/781/node-22.14.0
curl -fsSLO https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-arm64.tar.gz
# sha256 e9404633bc02a5162c5c573b1e2490f5fb44648345d64a958b17e325729a5e42 (matches SHASUMS256.txt)
tar xzf node-v22.14.0-darwin-arm64.tar.gz      # node v22.14.0, npm 10.9.2
```

The setup scripts put `node-v22.14.0-darwin-arm64/bin` first on PATH; `use22latest` restores the original PATH (Homebrew node@22, v22.23.1).

## Setup

```bash
git worktree add --detach ~/dev/mike-wt/gif781-main origin/main   # b91d1bdf4
git worktree add --detach ~/dev/mike-wt/gif781-pr  f8278e4ff
# root + backend node_modules cloned (cp -cR) from ~/dev/mike-wt/feature-flags (same lockfiles as main);
# the recordings then ran a real `npm ci` on top.
# backend/.env in both = ~/dev/mike/backend/.env with PORT/NODE_ENV/SENTRY_*/WORKERS_MODE/DB_JOBS_ENABLED/FRONTEND_URL replaced by:
#   PORT=4781 FRONTEND_URL=http://127.0.0.1:3781 NODE_ENV=development SENTRY_DISABLED=false
#   SENTRY_DSN=http://mike@127.0.0.1:9781/1 WORKERS_MODE=none DB_JOBS_ENABLED=false
PORT=9781 node ~/dev/mike/scripts/sentry-sink.mjs > ~/dev/mike-evidence/781/sink.log
# safety net: NODE_OPTIONS="--require ~/dev/mike-evidence/782/redirect-sentry-to-sink.cjs" SINK_PORT=9781
vhs before.tape    # sources setup-main.sh
vhs after.tape     # sources setup-pr.sh
ffmpeg -i before.mp4 -vf "setpts=PTS/1.25,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr781-before.gif
ffmpeg -i after.mp4  -vf "setpts=PTS/1.6,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr781-after.gif
```

No `[redirect]` line was logged in either run: every event used the explicit sink DSN (`project=1`), and nothing reached a real Sentry project. No database query is needed for either side. The crash happens at import time, and the refusals happen before the backend loads. The after GIF's last step, a successful boot on 22.23.1, did connect to the shared local Supabase stack for its health check. With workers and DB jobs off, it wrote nothing.

## pr781-before.gif (origin/main b91d1bdf4, Node 22.14.0)

Commands, in `backend/`:
```bash
git --no-pager log -1 --oneline --no-decorate; node -v; grep SENTRY_DSN .env
npm ci --no-audit --no-fund 2>&1 | grep -E "package: 'undici|^added"; echo "npm ci exit=${pipestatus[1]}"
npm run dev < /dev/null > $E/before-dev.log 2>&1 &!
until grep -q decompress.js $E/before-dev.log; do sleep 0.3; done; sleep 1.5; grep -E '^\[sentry\]|TypeError|decompress.js' $E/before-dev.log | head -3
ev   # sink: title, level, where, runtime, capture_source
```

1. `npm ci` prints `npm warn EBADENGINE   package: 'undici@8.12.3'` (one of 40 `EBADENGINE` warnings, all transitive), then `added 512 packages`, and exits 0.
2. `npm run dev` logs `[sentry] enabled for api (environment self-hosted, release mike@0.0.0)`, then `TypeError: Cannot read properties of undefined (reading 'bind')` at `node_modules/undici/lib/interceptor/decompress.js:78:30`. `tsx watch` keeps running (it waits for file changes), but the API never listens.
3. The sink has exactly one event, the 3R shape (raw: `before-sink-events.json`):
   ```
   project=1 level=fatal environment=self-hosted
   TypeError: Failure in application @ backend/node_modules/undici/lib/interceptor/decompress.js:78
   runtime node v22.14.0
   tags: service=mike-backend role=api install=community build_mode=development diagnostics_version=2 capture_source=unhandled occurrence=1
   ```
   The frames include `tsx/dist/register-*.cjs` and `@apm-js-collab/tracing-hooks`, as in the production events.

## pr781-after.gif (PR head f8278e4ff)

Commands, in `backend/`:
```bash
git --no-pager log -1 --oneline --no-decorate; node -v; cat .npmrc | tail -1          # v22.14.0, engine-strict=true
npm ci --no-audit --no-fund 2>&1 | grep notsup; echo "npm ci exit=${pipestatus[1]}"
npm run dev 2>&1 | tail -1; echo "npm run dev exit=${pipestatus[1]}"; cnt
use22latest; node -v                                                                  # v22.23.1
npm ci --no-audit --no-fund 2>&1 | grep -E 'EBADENGINE|^added'; echo "npm ci exit=${pipestatus[1]}"
npm test -- src/__tests__/nodeEngines.test.ts 2>&1 | grep -E 'Test Files|Tests '
npm run dev < /dev/null > $E/after-dev.log 2>&1 &!
until curl -s 127.0.0.1:4781/health >/dev/null; do sleep 0.3; done; grep -E '^\[sentry\]|running on' $E/after-dev.log; cnt
```

1. Node 22.14.0: `npm ci` fails with `npm error notsup Not compatible with your version of node/npm: mike-backend@1.0.0`, `Required: {"node":">=22.19.0"}`, `Actual: {"npm":"10.9.2","node":"v22.14.0"}` and exits 1. It fails before touching `node_modules` (343 entries still present after a real run, checked off camera).
2. Node 22.14.0: `npm run dev` stops in `predev` with `Mike's backend needs Node >=22.19.0 (package.json "engines"), but this is Node 22.14.0. Older 22.x releases crash at boot inside undici. Install a newer Node 22 (for example `nvm install 22`) and run the command again.` and exits 1. tsx never starts. `sink events: 0`.
3. Node 22.23.1: `npm ci` prints no `EBADENGINE` warning, `added 513 packages`, exit 0 (513 = main's 512 + `@types/semver`).
4. Node 22.23.1: `nodeEngines.test.ts`: `Test Files 1 passed (1)`, `Tests 14 passed (14)`.
5. Node 22.23.1: `npm run dev` passes `predev`, logs `[sentry] enabled for api ...` and `Mike backend running on port 4781 (workers: none)`, `/health` answers. `sink events: 0`.

## How reality differed from comments/781.md

- **Head and section 3.** Section 3 describes head 24fc0f2c9: a warning only, "Step 4 still crashes, and the same 3R event still fires", "No `.npmrc` ... sets `engine-strict`". This was recorded on f8278e4ff, where that no longer holds: `backend/.npmrc` has `engine-strict=true`, so `npm ci` fails with `notsup` (exit 1), and `predev` refuses to start, so no crash and no event. Section 3 step 2's expected `npm warn EBADENGINE ... mike-backend` is now `npm error notsup ... mike-backend`. This matches fixes/781.md.
- **Test count.** Section 3 step 5 says `nodeEngines.test.ts` passes 5/5. At f8278e4ff it has 14 tests (the fix pass added .npmrc, scripts, parse and dev-dependency cases), all passing.
- **Section 2 step 3** ("no engine warning for the backend package itself", only transitive `EBADENGINE`): confirmed. 40 transitive warnings, undici among them, exit 0.
- **Section 2 steps 4-5**: confirmed exactly, one `fatal` / `unhandled` event with `runtime v22.14.0`.
- **Sink port.** The comment uses :9999. I used :9781 to stay off ports other agents might be using.
- **Node 22.14 source.** The comment suggests `nvm` or `npx -y node@22.14.0`. Neither nvm nor a cached npx `node` package existed here, so I used the official tarball (see above).
- **Section 2 step 6** (test-level repro by reverting the package.json files) and **section 3 step 2's** "likewise in root, frontend and word-addin": not recorded. Only `backend/` has an `.npmrc`. The other packages still only warn, by design according to fixes/781.md.
- **Not recorded:** `npm start` / `prestart` (same script as `predev`), the Dockerfile `.npmrc` copy, and the desktop supervisor check.

## Files

`pr781-before.gif`, `pr781-after.gif`, unedited `before.mp4` / `after.mp4`, tapes `before.tape` / `after.tape`, `setup-main.sh` / `setup-pr.sh`, backend logs `before-dev.log` / `after-dev.log`, sink output `sink.log` (includes one off-camera dry run and the failed takes) and `before-sink-events.json` / `after-sink-events.json` (`[]`).

## Cleanup

All processes I started were stopped by PID: the sink, the dry-run `npm run dev` trees, and the `npm run dev` / `tsx watch` / node trees that each vhs recording left running. Nothing listens on :4781 or :9781. Worktrees `gif781-main` and `gif781-pr` removed. The Node 22.14.0 tarball and the extracted folder are kept in `node-22.14.0/` for reuse. They are not on any PATH.

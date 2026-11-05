# PR #780 evidence: bucket CORS generated from the backend's origins (live `docker compose up`)

Recorded 2026-11-05 with vhs (zsh, 1400 px wide), converted at 8 fps with a 64-colour palette.

- `pr780-before.gif`: origin/main **b91d1bdf4**, compose project `pr780main`, 23 s (recorded 26.8 s, played at 1.15x), 320 KB
- `pr780-after.gif`: PR head **e809d7f87**, compose project `pr780pr`, 24 s (recorded 39 s, played at 1.65x), 552 KB

Real `docker compose` stacks, one per head, from detached worktrees `~/dev/mike-wt/pr780-main` and `~/dev/mike-wt/pr780-pr` (both removed afterwards). The shared Supabase CLI stack (`supabase_*_backend`) and `rustfs` were not touched.

## Environment

Compose-root `.env` in each worktree (`NNN` = 561 for `pr780main`, 562 for `pr780pr`; all ports checked free with `lsof` first):

```
DB_PORT=NNN22  GATEWAY_PORT=NNN21  MAILPIT_PORT=NNN25  MAILPIT_SMTP_PORT=NNN26
STORAGE_PORT=NNN90  STORAGE_CONSOLE_PORT=NNN91  REDIS_PORT=NNN79
BACKEND_PORT=NNN01  FRONTEND_PORT=NNN00
MIKE_IMAGE_REPO=local-evidence/<project>   MIKE_IMAGE_TAG=evidence   # never overwrite ghcr.io/...:2.1.0
SENTRY_DISABLED=true
FRONTEND_URL=http://mike.example.test:3000
```

No `backend/.env` (the compose `env_file` entries are optional). `R2_PUBLIC_ENDPOINT_URL` left unset, so each head uses its compose default.

Builds: `docker compose -p pr780pr build storage-cors` (1 min 23 s; apt and `npm ci` layers were cached because the backend lockfile matches other local images) and `docker compose -p pr780main build backend` (main only needed the image for the boot-log comparison). Memory free stayed 31-46 % (`memory_pressure`) throughout; host disk 3.2 GiB free.

## Helpers used on screen (`helpers.zsh`, sourced off screen)

- `bucket-cors`: `docker compose -p $P run --rm --no-deps --entrypoint aws createbucket --endpoint-url http://storage:9000 s3api get-bucket-cors --bucket mike | jq -c '.CORSRules[0].AllowedOrigins'` (the policy the storage service serves).
- `generated-policy`: `cat /cors/storage-cors.json` from the `storage_cors` volume, same `jq`.
- `U`: a PUT URL presigned by `presign-put.cjs` with the same AWS SDK v3 settings as `backend/src/lib/storage/s3.ts` (region `auto`, path style, rustfs creds) against `http://localhost:<STORAGE_PORT>`.
- `preflight <origin>`: `curl -X OPTIONS "$U" -H "Origin: <origin>" -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type'`, printing status and `access-control-allow-origin`.
- `put <origin>`: the signed PUT itself with that Origin and `Content-Type: application/pdf`.
- `boot`: `docker compose -p $P run -d --rm --no-deps backend`, print its `[...]` lines up to the first `[startup]` line, stop it (no database attached in this shortcut, so boot stops at the lifecycle check). The full-stack boot is below.

## Before (origin/main b91d1bdf4, `pr780main`)

`docker compose -p pr780main up -d storage createbucket` (no build: main's createbucket mounts the checked-in JSON).

```
$ jq -c .CORSRules[0].AllowedOrigins docker/storage-cors.json
["http://localhost:3000","https://localhost:3200"]
$ bucket-cors
["http://localhost:3000","https://localhost:3200"]
$ preflight http://mike.example.test:3000
OPTIONS 403  access-control-allow-origin:
$ preflight http://localhost:3000
OPTIONS 200  access-control-allow-origin: http://localhost:3000
$ docker compose -p pr780main config backend | grep R2_PUBLIC
      R2_PUBLIC_ENDPOINT_URL: http://localhost:9000
$ boot
[sentry] disabled for api (SENTRY_DISABLED=true)
[startup] Could not verify the document-lifecycle migration: TypeError: fetch failed Retrying (1/6)...
```

Policy read back (`policy-before.json`):
```json
{"CORSRules":[{"AllowedHeaders":["Content-Type","x-amz-*"],"AllowedMethods":["PUT","HEAD"],"AllowedOrigins":["http://localhost:3000","https://localhost:3200"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}
```

## After (PR head e809d7f87, `pr780pr`)

```
$ docker compose -p pr780pr up storage-cors createbucket 2>&1 | grep -E '\| |exited'
storage-cors-1 exited with code 0
createbucket-1  | make_bucket: mike
createbucket-1 exited with code 0
$ generated-policy
["http://mike.example.test:3000","https://localhost:3200"]
$ bucket-cors
["http://mike.example.test:3000","https://localhost:3200"]
$ preflight http://mike.example.test:3000; put http://mike.example.test:3000
OPTIONS 200  access-control-allow-origin: http://mike.example.test:3000
PUT 200  access-control-allow-origin: http://mike.example.test:3000

# fail soft
$ FRONTEND_URL=mike.example.test:3000 docker compose -p pr780pr up storage-cors createbucket 2>&1 | grep -E '\| |exited'
storage-cors-1  | storage-cors: skipping "mike.example.test:3000": FRONTEND_URL and WORD_ADDIN_URL must be absolute http(s) URLs whose host is a DNS name or IP literal (no underscores); uploads from it will be refused by CORS
storage-cors-1  | storage-cors: adding the loopback development origins so the stack still starts
storage-cors-1 exited with code 0
createbucket-1  | make_bucket: mike
createbucket-1 exited with code 0
$ bucket-cors
["https://localhost:3200","http://localhost:3000"]

# boot warning
$ docker compose -p pr780pr config backend | grep R2_PUBLIC
      R2_PUBLIC_ENDPOINT_URL: http://localhost:56290
$ boot
[sentry] disabled for api (SENTRY_DISABLED=true)
[storage] R2_PUBLIC_ENDPOINT_URL points at loopback while FRONTEND_URL does not: browsers will try to upload to their own machine. Set R2_PUBLIC_ENDPOINT_URL to the storage URL browsers can reach (docs/deployment.md).
[startup] Could not verify the document-lifecycle migration: TypeError: fetch failed Retrying (1/6)...
```

Policy read back after the good run (`policy-after.json`; the generated file is `policy-after-generated.json`, identical rules):
```json
{"CORSRules":[{"AllowedHeaders":["Content-Type","x-amz-*"],"AllowedMethods":["PUT","HEAD"],"AllowedOrigins":["http://mike.example.test:3000","https://localhost:3200"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}
```

## The owed full `docker compose up` (not in the GIF)

After recording, from the same project (fresh `db_data`, `redis_data` volumes): `docker compose -p pr780pr up -d backend` (pulls in db, auth, rest, gateway, mailpit, redis, db-init, workflow-sync, storage, storage-cors, createbucket). Log: `pr-full-up.log`, `pr-full-up-ps.txt`, `pr-full-up-oneshots.log`, `pr-full-up-backend.log`.

- `storage-cors` recreated, `Exited (0)`; `createbucket` waited for it, `Exited (0)`; `db-init` and `workflow-sync` `Exited (0)`; every long-running service up (db, gateway, mailpit, redis healthy).
- Backend log: `[storage] R2_PUBLIC_ENDPOINT_URL points at loopback while FRONTEND_URL does not ...`, then `Mike backend running on port 3001 (workers: thread)`; `GET http://localhost:56201/health` -> 200.
- `docker inspect pr780pr-storage-cors-1` -> `NetworkMode=none` (createbucket is on `pr780pr_default`).
- Not run: a clean-volume `up` of the frontend, a browser upload, the Word add-in, the Sentry-sink steps (comments/780.md 2.4-2.5, 3.4-3.5), and `ALLOWED_ORIGINS` with a second origin.

## Mismatches with comments/780.md (and the brief)

1. **Section 3 step 2 is wrong about where the policy appears.** `docker compose logs storage-cors createbucket` does not show the generated `AllowedOrigins`: storage-cors redirects stdout into `/cors/storage-cors.json`, so on success its log is empty, and `put-bucket-cors` prints nothing. Read it from the volume (`generated-policy`) or the bucket (`get-bucket-cors`). Only the fail-soft case writes to the log (stderr).
2. **"Starts with FRONTEND_URL" understates it:** with `FRONTEND_URL` set, the generated list is `[FRONTEND_URL, https://localhost:3200]`; `http://localhost:3000` is gone (it is the FRONTEND_URL default, not an extra development origin). This matches the backend's own CORS allowlist, but a localhost user of a stack configured for a real hostname cannot upload from `localhost:3000` any more.
3. **Fail soft is two `storage-cors:` lines, not one** ("skipping ..." and "adding the loopback development origins ..."), as fixes/780.md describes; the brief's "single line" does not hold. The order of the fallback list is `["https://localhost:3200","http://localhost:3000"]`.
4. **Main's `R2_PUBLIC_ENDPOINT_URL` default ignores `STORAGE_PORT`** (`http://localhost:9000` with `STORAGE_PORT=56190`). On this machine :9000 is another stack's `rustfs`, so main's backend would sign URLs for the wrong storage service. The PR default follows the port (`http://localhost:56290`). For the before preflight I presigned against the project's real port (:56190) so the CORS check, not the wrong port, is what is shown.
5. On main the signed PUT itself returns 200 to curl; CORS is enforced by the browser at the preflight (403, no `access-control-allow-origin`). The GIF shows the preflight.
6. Used `mike.example.test` (as the brief suggested) rather than `mike.localtest.me`; no browser was involved, so DNS did not matter. With a non-loopback name the boot warning is a true positive, unlike the `localtest.me` false positive noted in section 3 step 3.
7. Section 2 step 3 ("no `[storage]` line on main") confirmed with main's own image.
8. `createbucket` prints `make_bucket: mike` on every run, even when the bucket exists (rustfs `mb` is idempotent), so `|| true` never matters here.

## Cleanup (exact commands; full output in `cleanup.log`)

```
cd ~/dev/mike-wt/pr780-main && docker compose -p pr780main down -v --rmi local
  -> removed pr780main-createbucket-1, pr780main-storage-1, volumes pr780main_{storage,redis,db}_data, network pr780main_default
cd ~/dev/mike-wt/pr780-pr && docker compose -p pr780pr down -v --rmi local
  -> removed all 12 pr780pr containers, volumes pr780pr_{storage,redis,db}_data + pr780pr_storage_cors,
     network pr780pr_default, image local-evidence/pr780pr/mike-backend:evidence
docker rmi local-evidence/pr780main/mike-backend:evidence local-evidence/pr780pr/mike-backend:evidence
  -> Untagged/Deleted pr780main image; "No such image" for pr780pr (already removed by --rmi local)
docker ps   -> supabase_{studio,pg_meta,edge_runtime,storage,rest,realtime,inbucket,auth,kong,vector,analytics,db}_backend and rustfs all Up (18-28 h)
docker ps -a / volume ls / network ls --filter name=pr780 -> empty
git worktree remove --force ~/dev/mike-wt/pr780-main ~/dev/mike-wt/pr780-pr
```

Two transient probe containers (`pr780pr-backend-probe`, `pr780{main,pr}-boot`) were `--rm` runs and were gone before teardown.

## Files

`before.tape`, `after.tape`, `helpers.zsh`, `presign-put.cjs`, `before.mp4`, `after.mp4`, policy JSONs, build and up logs, `backend-probe.log`, `cleanup.log`.

Convert:
```
ffmpeg -i before.mp4 -vf "crop=1400:420:0:0,setpts=PTS/1.15,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr780-before.gif
ffmpeg -i after.mp4  -vf "crop=1400:670:0:0,setpts=PTS/1.65,fps=8,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none" -loop 0 pr780-after.gif
```

# PR #789 evidence: Word add-in opened outside Office

Recorded 2026-11-05 with the Chrome DevTools MCP screencast (plain Chrome tab, isolated context, no Office host), 2880x1454 viewport, converted to GIF at 8 fps / 1280 px.

## pr789-before.gif (origin/main b91d1bdf4)

1. Loads `http://127.0.0.1:3100/taskpane.html`.
2. The pane shows the crash fallback: "Something went wrong / The add-in hit an unexpected error. It has been reported. / Try again".
3. Switches to the sink's events page (`http://localhost:9999/`): **2 events**.

Console: `[warn] Unable to notify the host about Office.js runtime information: TypeError: OSF.OUtil.externalNativeFunctionExists is not a function`, then `[error] ReferenceError: OfficeRuntime is not defined`.

Sink events (both `level=error`, project 3, no `office_host` tag):

```
ReferenceError: Failure in application @ taskpane.7b6f35b2.js:2
  service=mike-word-addin surface=taskpane build_mode=production diagnostics_version=2 install=community capture_source=console occurrence=1
ReferenceError: Failure in word.session / notify @ taskpane.7b6f35b2.js:2
  service=mike-word-addin surface=taskpane build_mode=production diagnostics_version=2 install=community component=notify operation=word.session capture_source=exception occurrence=1
```

These match Sentry MIKE-WORD-ADDIN-6 (console) and MIKE-WORD-ADDIN-7 (word.session / notify).

## pr789-after.gif (PR head 204a0a25a)

1. Same URL, same sink (events cleared first with `DELETE /events`).
2. The pane shows "Open Mike in Word" / "This page is Mike's Word add-in. It works inside Microsoft Word, from the Mike button on the Home tab." No button.
3. Switches to the sink's events page: **0 events**.

Console: only the same Office.js `Unable to notify the host...` warning; no ReferenceError. Network: no XHR/fetch requests at all (so no `/auth/session`). Sink terminal printed no new lines.

## Commands

```bash
git worktree add ~/dev/mike-wt/gif789-main origin/main          # b91d1bdf4
git worktree add ~/dev/mike-wt/gif789-pr 204a0a25a2d19a499790560bacdda92b9f011607
npm ci --prefix word-addin                                       # in each worktree
node scripts/sentry-sink.mjs                                     # :9999
REACT_APP_API_BASE_URL=/api REACT_APP_WEB_APP_URL=http://localhost:3000 \
  REACT_APP_SENTRY_DSN=http://mike@localhost:9999/3 npm run build --prefix word-addin
npx http-server word-addin/dist -p 3100 -a 127.0.0.1 -c-1
# open http://127.0.0.1:3100/taskpane.html in a plain Chrome tab, then http://localhost:9999/
ffmpeg -ss 3.5 -i in.mp4 -vf "fps=8,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse" -loop 0 out.gif
```

## Differences from the reproduction steps in the review comment

- A production build also needs `REACT_APP_WEB_APP_URL` (webpack refuses to build without it); `REACT_APP_API_BASE_URL=/api` was set as in `build:e2e`. The final `build-manifest.js` step then fails without `WORD_ADDIN_PUBLIC_URL`, after `dist/` is already written; the bundle served is unaffected.
- The console warning seen was `Unable to notify the host about Office.js runtime information: TypeError: OSF.OUtil.externalNativeFunctionExists is not a function`, not `Office.js is loaded outside of Office client`.
- "Before" used origin/main b91d1bdf4 (main has moved since 70786b18f); behaviour is as described.

## pr789-after-v2.gif (fixed PR head 6470ad044), recorded 2026-11-05

Replaces `pr789-after.gif` as the "after" evidence. `pr789-before.gif` is unchanged.

1. Sink events cleared first (`DELETE /events` -> 204, `GET /events` -> `[]`).
2. Loads `http://127.0.0.1:3105/taskpane.html` in a plain Chrome tab (isolated context, no Office host).
3. The pane shows "Open Mike in Word" / "This page is Mike's Word add-in. It works inside Microsoft Word." No ribbon-button or Home-tab wording, no button.
4. Switches to the sink's events page (`http://localhost:9997/`): **0 events**. `GET /events` still `[]` after the recording.

Console: `[warn] Unable to notify the host about Office.js runtime information: TypeError: OSF.OUtil.externalNativeFunctionExists is not a function`, `[log] Warning: Office.js is loaded outside of Office client`, and a favicon 404. No ReferenceError. Network: no XHR/fetch requests (only the favicon 404).

The new one-warning path (a real Office client whose onReady resolves with a null host) cannot be produced in a plain browser tab; it is covered by the `outsideOfficeDiagnostics` e2e case in `outside-office.spec.ts`. This recording shows the crawler / plain-tab path staying silent.

Differences from the first recording: port 9999 was held by another process on this machine, so the sink ran with `PORT=9997` and the build used `REACT_APP_SENTRY_DSN=http://mike@localhost:9997/3`; http-server used port 3105. Worktree `~/dev/mike-wt/gif789-v2` at 6470ad044 (removed afterwards). Same ffmpeg command (`-ss 3.5`, 8 fps, 1280 px). Raw screencast kept as `after-v2.mp4` (2880x1454, 20.7 s).

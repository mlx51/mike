#!/usr/bin/env node
// Network fault proxy (PR #776 evidence). Scoped to ONE backend process:
// that backend's SUPABASE_URL points here; everything is piped unchanged to
// the real gateway (UPSTREAM, default 127.0.0.1:54321) EXCEPT
// POST /rest/v1/rpc/find_document_text while a fault mode is set. Then the
// proxy answers 307 to a target the backend's own fetch cannot reach, so
// undici (not this proxy) raises the network error and supabase-js builds its
// real blank-code result from it:
//   refused  -> 307 http://127.0.0.1:59999/...   (closed port: ECONNREFUSED)
//   nxdomain -> 307 http://nope.invalid:5432/...     (no DNS: ENOTFOUND)
//   pass     -> no fault
//   hold     -> every /rest/v1/* request (except the boot probe below) waits
//               unanswered; switching to refused_all/nxdomain_all releases them
//               with that mode's 307 (a parked worker meets the outage live)
//   refused_all / nxdomain_all -> the same for EVERY /rest/v1/* request
//               (GoTrue /auth/v1/* still passes, so the bearer token keeps working,
//               and so does the boot probe rpc/document_lifecycle_version, so a
//               backend can start into the outage; nothing else reaches the DB)
// Control (never forwarded):  curl -X POST 127.0.0.1:$PORT/__fault/<refused|nxdomain|pass>
//                             curl 127.0.0.1:$PORT/__fault          (mode + hits)
import http from "node:http";

const port = Number(process.env.PORT ?? 54776);
const [upHost, upPort] = (process.env.UPSTREAM ?? "127.0.0.1:54321").split(":");
const targets = { refused: "http://127.0.0.1:59999", nxdomain: "http://nope.invalid:5432" };
let mode = process.env.MODE ?? "pass";
let hits = [];
let held = [];

http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  const ctl = path.match(/^\/__fault(?:\/(\w+))?$/);
  if (ctl) {
    if (req.method === "POST" && ctl[1]) {
      mode = ctl[1]; hits = [];
      const to = targets[mode.replace(/_all$/, "")];
      if (to) for (const [r, s] of held.splice(0)) {
        hits.push(`${new Date().toISOString().slice(11, 23)} ${r.method} ${r.url.split("?")[0].slice(9)} (held) -> 307 ${to}`);
        s.writeHead(307, { location: to + r.url }); s.end();
      }
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ mode, hits }) + "\n");
    return;
  }
  if (mode === "hold" && path.startsWith("/rest/v1/") && path !== "/rest/v1/rpc/document_lifecycle_version") {
    req.resume(); held.push([req, res]); return;
  }
  const all = mode.endsWith("_all") && path.startsWith("/rest/v1/") && path !== "/rest/v1/rpc/document_lifecycle_version";
  if (all || (req.method === "POST" && path === "/rest/v1/rpc/find_document_text")) {
    const to = targets[mode.replace(/_all$/, "")];
    hits.push(`${new Date().toISOString().slice(11, 23)} ${req.method} ${path.slice(9)} -> ${to ? `307 ${to}` : "passed through"}`);
    if (to) {
      req.resume();
      res.writeHead(307, { location: to + req.url });
      res.end();
      return;
    }
  }
  const up = http.request({ host: upHost, port: Number(upPort), method: req.method, path: req.url,
    headers: { ...req.headers, host: `${upHost}:${upPort}` } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502).end(String(e.code)); });
  req.pipe(up);
}).listen(port, "127.0.0.1", () => console.log(`network fault proxy :${port} -> ${upHost}:${upPort}`));

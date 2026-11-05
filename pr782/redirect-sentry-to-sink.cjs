// Preloaded with NODE_OPTIONS="--require .../redirect-sentry-to-sink.cjs".
// Sends anything addressed to *.sentry.io to the local sink on :9999 instead,
// so the built-in Mike project DSN (hardcoded, no env override) can be shown
// without a single event reaching the real Mike Sentry project.
const http = require("node:http");
const https = require("node:https");
const SINK_PORT = Number(process.env.SINK_PORT || 9999);
const isSentry = (h) => typeof h === "string" && /(^|\.)sentry\.io$/i.test(h);
const origRequest = https.request;
https.request = function (opts, ...rest) {
  if (opts && typeof opts === "object" && !(opts instanceof URL) && isSentry(opts.hostname || opts.host)) {
    process.stderr.write(`[redirect] ${opts.hostname || opts.host}${String(opts.path).split("?")[0]} -> http://127.0.0.1:${SINK_PORT}\n`);
    const { agent, ca, protocol, host, hostname, port, ...keep } = opts;
    return http.request({ ...keep, hostname: "127.0.0.1", port: SINK_PORT, protocol: "http:" }, ...rest);
  }
  if ((typeof opts === "string" || opts instanceof URL) && isSentry(new URL(String(opts)).hostname)) {
    throw new Error("redirect-sentry-to-sink: refusing URL-form sentry.io request");
  }
  return origRequest.call(this, opts, ...rest);
};
require("node:module").syncBuiltinESMExports();
const origFetch = globalThis.fetch;
if (origFetch) {
  globalThis.fetch = function (input, init) {
    try {
      const u = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      if (isSentry(u.hostname)) {
        const to = `http://127.0.0.1:${SINK_PORT}${u.pathname}${u.search}`;
        process.stderr.write(`[redirect] fetch ${u.hostname}${u.pathname} -> ${to}\n`);
        if (typeof input === "object" && !(input instanceof URL)) return origFetch(new Request(to, input), init);
        return origFetch(to, init);
      }
    } catch {}
    return origFetch.call(this, input, init);
  };
}
// Safety net: log (and refuse) any TLS connection to sentry.io that did not
// go through the redirect above.
const tls = require("node:tls");
const origConnect = tls.connect;
tls.connect = function (...args) {
  const o = args.find((a) => a && typeof a === "object") || {};
  const host = o.servername || o.host || (typeof args[1] === "string" ? args[1] : "");
  if (isSentry(host)) {
    process.stderr.write(`[redirect] BLOCKED direct TLS connection to ${host}\n`);
    throw new Error("redirect-sentry-to-sink: blocked direct sentry.io TLS");
  }
  return origConnect.apply(this, args);
};
require("node:module").syncBuiltinESMExports();

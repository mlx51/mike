#!/usr/bin/env node
// Anthropic Messages stub (PR #777 evidence). A request whose last message
// carries no tool_result answers with ONE tool_use block for find_documents
// using the current input; the follow-up (with the tool_result) answers with
// a short text. Streams (SSE) when the request has stream:true.
//   curl -X POST 127.0.0.1:$PORT/input/valid    -> {"scope":"library","query":"indemnity"}
//   curl -X POST 127.0.0.1:$PORT/input/invalid  -> {"scope":"library","query":"x"}  (1 char: invalid_search)
//   GET /log -> what the stub answered, plus the tool_result it was sent back
import http from "node:http";

const port = Number(process.env.PORT ?? 4177);
const inputs = { valid: { scope: "library", query: "indemnity" }, invalid: { scope: "library", query: "x" } };
let input = "valid";
let log = [];
let n = 0;

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

http.createServer((req, res) => {
  const m = req.url.match(/^\/input\/(valid|invalid)$/);
  if (m && req.method === "POST") { input = m[1]; log = []; res.end(`tool input ${input}: ${JSON.stringify(inputs[input])}\n`); return; }
  if (req.url === "/log") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(log)); return; }
  if (req.method !== "POST" || !/\/messages$/.test(req.url.split("?")[0])) { res.writeHead(404).end(); return; }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const last = body.messages?.at(-1);
    const toolResult = Array.isArray(last?.content) && last.content.find((c) => c.type === "tool_result");
    const id = `msg_stub_${++n}`;
    const usage = { input_tokens: 10, output_tokens: 5 };
    const start = ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } }];
    if (!toolResult) {
      const tu = { type: "tool_use", id: `toolu_stub_${n}`, name: "find_documents", input: inputs[input] };
      log.push({ answered: "tool_use find_documents", input: tu.input });
      if (!body.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id, type: "message", role: "assistant", model: body.model, content: [tu], stop_reason: "tool_use", stop_sequence: null, usage })); return; }
      sse(res, [start,
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: tu.id, name: tu.name, input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tu.input) } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } }],
        ["message_stop", { type: "message_stop" }]]);
      return;
    }
    const sent = typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content);
    log.push({ answered: "text", tool_result_sent_back: sent.slice(0, 160) });
    const text = "The document search did not complete, so I cannot confirm whether 'indemnity' appears.";
    if (!body.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage })); return; }
    sse(res, [start,
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
      ["message_stop", { type: "message_stop" }]]);
  });
}).listen(port, "127.0.0.1", () => console.log(`anthropic tool_use stub on :${port}`));

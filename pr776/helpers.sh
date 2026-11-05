# Sourced by the tapes and dry runs (adapted from mike-evidence/777/helpers.sh).
setopt interactivecomments 2>/dev/null
API=127.0.0.1:4776 SINK=127.0.0.1:9776 STUB=127.0.0.1:4176 PROXY=127.0.0.1:54776
T=$(zsh ~/dev/mike-evidence/776/token.sh)   # fresh bearer token (GoTrue admin magic link + verify)
auth=(-H "Authorization: Bearer $T" -H 'content-type: application/json')
# fault <refused|nxdomain|pass>: what the proxy does with rpc/find_document_text
fault() { curl -s -X POST $PROXY/__fault/$1 | jq -r '"proxy fault: \(.mode)"'; }
# turn: titled chat, one message; print the doc_search frame, the proxy hit and the tool_result the model got back
turn() {
  local id=$(curl -s "${auth[@]}" -X POST $API/chat/create -d '{}' | jq -r .id)
  curl -s -o /dev/null "${auth[@]}" -X PATCH $API/chat/$id -d '{"title":"gif776"}'
  curl -sN "${auth[@]}" -X POST $API/chat -d "{\"chat_id\":\"$id\",\"model\":\"claude-sonnet-5-5\",\"messages\":[{\"role\":\"user\",\"content\":\"search my documents for indemnity\"}]}" \
    | sed -n 's/^data: //p' | jq -c 'select(.type=="doc_search" or .type=="error") | {type, error_code, error}' 2>/dev/null
  echo "proxy: $(curl -s $PROXY/__fault | jq -r '.hits[-1] // "no rpc call"')"
  echo "tool_result sent to model: $(curl -s $STUB/log | jq -r '.[-1].tool_result_sent_back // "-"')"
  sleep 1.5
}
ev() { curl -s $SINK/events | jq -c ".[]" >> ${EVLOG:-/dev/null}; curl -s $SINK/events | jq -c '.[] | {level, title, tags: (.tags | {component, operation, error_kind, failure_code, capture_source} | with_entries(select(.value != null)))}'; echo "sink events: $(curl -s $SINK/events | jq length)"; }
clr() { curl -s -X DELETE $SINK/events >/dev/null; }
mark() { APIMARK=$(wc -l < $APILOG); }
apilog() { tail -n +$((APIMARK+1)) $APILOG | grep 'find_documents' | head -2; }
run() { clr; fault $1; mark; turn; ev; echo "API log:"; apilog; }

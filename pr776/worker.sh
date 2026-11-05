# The worker backend: a second process on :4775 from the same worktree, worker threads on,
# behind its own proxy :54775 that starts in mode "hold" (every /rest/v1 call parks unanswered,
# boot probe excepted), so its upload worker can never reach, let alone claim, a shared job.
PROXY2=127.0.0.1:54775
startworker() { curl -s -X POST $PROXY2/__fault/hold >/dev/null
  PORT=4775 WORKERS_MODE=thread SUPABASE_URL=http://$PROXY2 node --import tsx src/index.ts > $WAPILOG 2>&1 &!
  echo $! > $E/wapi.pid; until curl -s 127.0.0.1:4775/health >/dev/null; do sleep 0.3; done; }
# wev: wait for the upload-worker event, then print the sink rows
wev() { for i in {1..60}; do curl -s $SINK/events | jq -e 'any(.[]; .tags.component=="upload-worker")' >/dev/null && break; sleep 0.25; done; ev; }
# outage: the parked worker's gateway now refuses every connection (MIKE-BACKEND-X)
outage() { clr; curl -s -X POST $PROXY2/__fault/refused_all | jq -r '"worker proxy fault: \(.mode); released \(.hits | length) parked DB calls"'; wev; }

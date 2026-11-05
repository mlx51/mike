cd ~/dev/mike-wt/gif776-main/backend
export SINK_PORT=9776 NODE_OPTIONS="--require /Users/amalanandmuthukumaran/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"
E=~/dev/mike-evidence/776
APILOG=$E/pr776-main-api.log
node --import tsx src/index.ts > $APILOG 2>&1 &!
echo $! > $E/api.pid
source $E/helpers.sh; source $E/worker.sh; WAPILOG=$E/pr776-main-worker.log; EVLOG=$E/before-sink-events.jsonl; : > $EVLOG
until curl -s $API/health >/dev/null; do sleep 0.3; done
startworker; clr; mark   # worker backend parked behind :54775 (mode hold)
export PS1='main $ '
clear

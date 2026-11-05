cd ~/dev/mike-wt/gif782-main/backend
export NODE_OPTIONS="--require /Users/amalanandmuthukumaran/dev/mike-evidence/782/redirect-sentry-to-sink.cjs"
unset SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
curl -s -X DELETE localhost:9999/events >/dev/null
setopt interactivecomments
export PS1='main $ '
clear

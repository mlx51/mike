Output after.mp4
Set Shell zsh
Set FontSize 16
Set Width 1400
Set Height 860
Set Padding 16
Set TypingSpeed 5ms
Set Theme "Builtin Dark"
Hide
Type "source ~/dev/mike-evidence/782/setup-pr.sh" Enter
Sleep 1s
Show
Type "git --no-pager log -1 --oneline --no-decorate   # AFTER: PR #782 head" Enter
Sleep 0.4s
Type "grep -E '^(NODE_ENV|SENTRY)' .env   # same env, still no SENTRY_DSN" Enter
Sleep 0.8s
Type "MANIFEST_SIGNING_KEY=not-hex npm run dev 2>&1 | grep -E '^\[sentry|^\[redirect|failed to start'" Enter
Sleep 8s
Ctrl+C
Sleep 0.3s
Type "curl -s localhost:9999/events | jq length   # nothing left the laptop" Enter
Sleep 1s
Type "# opt in on purpose: same boot error with SENTRY_DSN pointed at the sink" Enter
Type "SENTRY_DSN=http://mike@localhost:9999/1 MANIFEST_SIGNING_KEY=not-hex npm run dev 2>&1 | grep -E '^\[sentry|failed to start'" Enter
Sleep 8s
Ctrl+C
Sleep 0.3s
Type "curl -s localhost:9999/events | jq -c '.[] | {project, environment, title, build_mode: .tags.build_mode}'" Enter
Sleep 1.5s
Type "grep -h '^\[sentry' ~/dev/mike-evidence/782/after-frontend.log; curl -s 127.0.0.1:3782/monitoring; echo   # next dev" Enter
Sleep 3.5s

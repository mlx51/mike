Output before.mp4
Set Shell zsh
Set FontSize 17
Set Width 1400
Set Height 800
Set Padding 18
Set TypingSpeed 6ms
Set Theme "Builtin Dark"
Hide
Type "source ~/dev/mike-evidence/782/setup-main.sh" Enter
Sleep 1s
Show
Type "git --no-pager log -1 --oneline --no-decorate   # BEFORE: origin/main" Enter
Sleep 0.5s
Type "grep -E '^(NODE_ENV|SENTRY)' .env   # no SENTRY_DSN" Enter
Sleep 1.2s
Type "# npm run dev (tsx watch) with a deliberate boot error; *.sentry.io traffic is redirected to the local sink" Enter
Type "MANIFEST_SIGNING_KEY=not-hex npm run dev 2>&1 | grep -E '^\[sentry|^\[redirect|failed to start'" Enter
Sleep 9s
Ctrl+C
Sleep 0.4s
Type "curl -s localhost:9999/events | jq '.[] | {project, environment, title, build_mode: .tags.build_mode}'" Enter
Sleep 0.8s
Type "# project 4512288204718080 = the Mike project's backend DSN (MIKE_SENTRY_DSN.backend)" Enter
Sleep 1.5s
Type "grep -h '^\[sentry' ~/dev/mike-evidence/782/before-frontend.log; curl -s 127.0.0.1:3782/monitoring; echo   # next dev" Enter
Sleep 3.5s

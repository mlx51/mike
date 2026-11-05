Output pr776-before.mp4
Set Shell zsh
Set FontSize 13
Set Width 1700
Set Height 680
Set Padding 12
Set TypingSpeed 2ms
Set Theme "Builtin Dark"
Hide
Type "source /Users/amalanandmuthukumaran/dev/mike-evidence/776/setup-main.sh" Enter
Wait@120s /\$$/
Sleep 0.5s
Show
Type "git --no-pager log -1 --oneline --no-decorate   # BEFORE: origin/main; SUPABASE_URL -> fault proxy :54776, model -> find_documents stub" Enter
Sleep 0.6s
Type "run refused    # 1) model calls find_documents; proxy 307s the RPC to a closed port: real supabase-js result, code '', details '... (ECONNREFUSED)'" Enter
Wait@90s /\$$/
Sleep 1.5s
Type "run nxdomain   # 2) same search; 307 to nope.invalid: the gateway host does not resolve (ENOTFOUND)" Enter
Wait@90s /\$$/
Sleep 1.5s
Type "outage         # 3) whole gateway down (MIKE-BACKEND-X): a worker-thread backend (:4775, own proxy) was parked; its DB calls now get ECONNREFUSED" Enter
Wait@60s /\$$/
Sleep 2s
Hide
Type "kill $(cat $E/wapi.pid) $(cat $E/api.pid); fault pass; curl -s -X POST $PROXY2/__fault/hold" Enter
Sleep 1s

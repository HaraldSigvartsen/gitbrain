# Record with: ./scripts/demo.sh --vhs  (requires `vhs` on PATH, offline)
Output docs/demo.gif
Set Shell bash
Set FontSize 16
Set Width 920
Set Height 520
Set Theme "Catppuccin Mocha"
Set Padding 24

Hide
Type "cd ${GITBRAIN_ROOT}"
Enter
Sleep 500ms
Show

Type "# gitbrain: drift then heal (see examples/demo-project/)"
Enter
Sleep 800ms

Type "./scripts/demo.sh"
Enter
Sleep 6s

Type "# optional: regenerate committed transcript"
Enter
Sleep 500ms
Type "./scripts/demo.sh --refresh"
Enter
Sleep 4s

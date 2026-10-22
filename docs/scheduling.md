# Scheduling `brain heal`

Memory drifts when code changes faster than agents update `.brain/`. Run `brain heal` on a
timer (or after large refactors) so stale observations and context paths get repaired before
the next session.

## GitHub Actions (opens a PR)

Copy the example workflow into your repo:

```bash
mkdir -p .github/workflows
cp path/to/gitbrain/examples/github-action/heal.yml .github/workflows/brain-heal.yml
```

The workflow installs gitbrain, runs `brain heal .`, and opens a pull request only when
something changed. See [examples/github-action/README.md](../examples/github-action/README.md)
for permissions and customization.

## Linux / macOS cron (local commit)

Install the CLI once (`npm install -g github:HaraldSigvartsen/gitbrain`), then add a crontab
line (edit with `crontab -e`):

```cron
0 6 * * 1 cd /path/to/your-repo && brain heal --commit .
```

Monday 06:00 — adjust schedule and path. `--commit` writes a local commit covering only
`.brain/`; you still push when ready (`git push`).

Preview without writing:

```bash
brain heal --dry-run .
```

## macOS launchd (one-shot install via `launchctl`)

For a weekly launchd job without editing XML by hand, load a one-liner plist path (replace
`YOUR_USER` and the repo path):

```bash
printf '%s\n' \
  '<?xml version="1.0" encoding="UTF-8"?>' \
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
  '<plist version="1.0"><dict>' \
  '<key>Label</key><string>com.gitbrain.heal</string>' \
  '<key>ProgramArguments</key><array>' \
  '<string>/bin/bash</string><string>-lc</string>' \
  '<string>cd /path/to/your-repo &amp;&amp; brain heal --commit .</string>' \
  '</array>' \
  '<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>' \
  '</dict></plist>' \
  > ~/Library/LaunchAgents/com.gitbrain.heal.plist \
  && launchctl load ~/Library/LaunchAgents/com.gitbrain.heal.plist
```

Unload with `launchctl unload ~/Library/LaunchAgents/com.gitbrain.heal.plist`.

## CI without pull requests

In a private monorepo you may prefer to commit on `main` from a trusted bot account. The
supported pattern is still: run `brain heal`, review `git diff`, then commit — never let heal
touch files outside `.brain/`. For reviewable history, the GitHub Action PR flow is the default
recommendation.

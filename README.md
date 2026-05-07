# nba-statusline

Today's NBA scores in the [Claude Code](https://docs.claude.com/en/docs/claude-code) status line.

```
● MIN  55 -  89 SA  · Q3 3:02
🏀 PHI 102 - 108 NY  · Final
🏀 LAL @ BOS · 7:30 PM
```

- Live games show a red `●` and bold the leading score.
- Finished games are dimmed.
- Pre-game lines show the tip-off in your local time.
- No API key. No telemetry. The only outbound request is to `site.api.espn.com`.

## Install

### Global (recommended)

```sh
npm install -g nba-statusline
```

Then add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "nba-statusline",
    "refreshInterval": 30
  }
}
```

### Without installing

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx -y nba-statusline@latest",
    "refreshInterval": 30
  }
}
```

`npx` will pull the package on first invocation; subsequent runs use the npm cache.

After editing `settings.json`, the status line refreshes on the next assistant message — no Claude Code restart needed.

## How it works

The script reads JSON from stdin (Claude Code passes session metadata; we drain it but don't use it), fetches today's scoreboard from ESPN, caches the response in `os.tmpdir()/nba-statusline/scores.json`, and writes formatted lines to stdout.

- **Cache TTL** — 25 seconds while any game is live, 5 minutes otherwise. With `refreshInterval: 30` ESPN gets hit roughly twice a minute during live games.
- **Timeouts** — fetch is hard-capped at 1.5 seconds. If ESPN is slow or offline and there's a stale cache, the stale data is shown with a `(cached Nm ago)` suffix. With no cache at all, the line shows `🏀 NBA scores unavailable` instead of going blank.
- **Always exits 0** — a blank status line can't be distinguished from a broken script. Every code path prints at least one line.

## Configuration

All optional. Set in your shell or in `settings.json` env (Claude Code 2.1.97+).

| Variable                    | Default | Effect                                                    |
| --------------------------- | ------- | --------------------------------------------------------- |
| `NBA_STATUSLINE_MAX`        | `6`     | Cap on rows shown. Live games always come first.          |
| `NBA_STATUSLINE_BACKUP`     | unset   | Set to `nbacdn` to use NBA's CDN endpoint (manual toggle).|
| `NBA_STATUSLINE_FIXTURE`    | unset   | Dev only: read `tests/fixtures/<name>.json` instead of API.|
| `NO_COLOR`                  | unset   | Disable all ANSI color/style output (community standard). |
| `TZ`                        | system  | Timezone for pre-game tip-off times.                      |

Examples:

```sh
# show only live games (effectively)
NBA_STATUSLINE_MAX=3 nba-statusline

# uncolored output for terminals that mangle ANSI
NO_COLOR=1 nba-statusline
```

## Output by game state

| State    | Format                                            |
| -------- | ------------------------------------------------- |
| Live     | `● LAL 102 -  98 BOS · Q4 2:30` (red dot, leader bold) |
| Live OT  | `● LAL 110 - 110 BOS · OT 1:23` / `OT2`, `OT3`...  |
| Final    | `🏀 LAL 118 - 110 BOS · Final` (whole line dimmed) |
| Final OT | `🏀 LAL 118 - 115 BOS · Final/OT` / `Final/OT2`... |
| Pre      | `🏀 LAL @ BOS · 7:30 PM` (your local time)        |
| No games | `🏀 No NBA games today`                           |
| Offline  | `🏀 NBA scores unavailable` (no cache available)  |

## Troubleshooting

- **Status line is blank** — make sure your shell can find `nba-statusline` (`which nba-statusline` / `Get-Command nba-statusline`). On Windows without Git Bash, prefer the `npx` form. Use `claude --debug` to see the script's exit code and stderr.
- **Wrong tip-off time** — Node uses your system timezone. Set `TZ=America/Los_Angeles` (or whatever) in your shell to override.
- **Want to force a refresh** — delete the cache file: `rm $TMPDIR/nba-statusline/scores.json` (POSIX) or `Remove-Item (Join-Path $env:TEMP 'nba-statusline\scores.json')` (PowerShell).
- **ESPN is flaky** — set `NBA_STATUSLINE_BACKUP=nbacdn` to switch to NBA's CDN endpoint. Note: parsing for the backup feed isn't fully implemented in 0.1.0; the fallback exists primarily as an escape hatch.

## Local development

```sh
git clone <repo>
cd nba-statusline

# fixture-driven smoke tests (no network)
NBA_STATUSLINE_FIXTURE=live  echo '{}' | node bin/nba-statusline.js
NBA_STATUSLINE_FIXTURE=final echo '{}' | node bin/nba-statusline.js
NBA_STATUSLINE_FIXTURE=pre   echo '{}' | node bin/nba-statusline.js
NBA_STATUSLINE_FIXTURE=none  echo '{}' | node bin/nba-statusline.js

# real ESPN
echo '{}' | node bin/nba-statusline.js

# put your local checkout on PATH for end-to-end testing in Claude Code
npm link
```

## Privacy

The script reads stdin (and ignores it), writes to `os.tmpdir()/nba-statusline/`, and makes one outbound HTTPS request to `site.api.espn.com` (or `cdn.nba.com` if `NBA_STATUSLINE_BACKUP=nbacdn`). Nothing else.

## License

MIT.

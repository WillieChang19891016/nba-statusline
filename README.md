# nba-statusline

Today's NBA scores and box scores for [Claude Code](https://docs.claude.com/en/docs/claude-code) — a status line that shows live scores, plus a `/nba-box` slash command for full per-player box scores.

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
npm install -g WillieChang19891016/nba-statusline
```

This installs straight from GitHub — no npm registry account needed. Pin to a specific commit or tag with `#sha` / `#v0.2.1` if you want.

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
    "command": "npx -y github:WillieChang19891016/nba-statusline",
    "refreshInterval": 30
  }
}
```

`npx` will pull the package on first invocation; subsequent runs use the npm cache.

After editing `settings.json`, the status line refreshes on the next assistant message — no Claude Code restart needed.

## How it works

The script reads JSON from stdin (Claude Code passes session metadata; we drain it but don't use it), fetches today's scoreboard from ESPN, caches the response in `os.tmpdir()/nba-statusline/scores.json`, and writes formatted lines to stdout.

- **Cache TTL** — adapts to what's happening, so we don't poll ESPN when nothing is going to change:
  - **Live game**: 25 seconds (track score updates closely)
  - **Upcoming game today**: cache until the next tip-off + 30 seconds (no point polling before the game starts)
  - **All games finished / no games today**: 6 hours (avoid pointless polling; the 6-hour cap ensures the next day's schedule still gets picked up)
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

## Box scores via slash command

Once installed, the package also ships a `/nba-box` Claude Code slash command. It runs in a **forked subagent** so the raw box-score data, intermediate JSON, and reasoning **stay out of your main conversation context** — only the final markdown table comes back as a single message.

Usage:

- `/nba-box` — auto-picks a game (live → pre → post)
- `/nba-box LAL` — pick by team abbreviation
- `/nba-box 401871160` — pick by ESPN event id

Output is a per-team markdown table (MIN / PTS / FG / 3PT / FT / REB / AST / STL / BLK / +/-).

**Requires `CLAUDE_CODE_FORK_SUBAGENT=1`** in your Claude Code env (settings.json `env` block) plus Claude Code v2.1.117+. Without it the skill still runs, just inline (raw output ends up in your main context).

Setup (one-time, until you publish a real plugin):

```sh
# copy the slash command into your user commands directory
cp ~/path/to/nba-statusline/commands/nba-box.md ~/.claude/commands/nba-box.md
```

Or on Windows PowerShell:

```powershell
Copy-Item C:\path\to\nba-statusline\commands\nba-box.md $HOME\.claude\commands\nba-box.md
```

The command relies on two helper binaries the package ships alongside `nba-statusline`:

- `nba-games` — prints today's games as JSON (used to build the picker).
- `nba-box <eventId>` — prints a plain-text box score for one game.

Both are on `PATH` after `npm install -g WillieChang19891016/nba-statusline`. They're also useful directly from the terminal.

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

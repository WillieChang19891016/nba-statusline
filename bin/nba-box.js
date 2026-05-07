#!/usr/bin/env node
'use strict';

const espn = require('../lib/espn');

const COLUMNS = [
  { key: 'MIN', label: 'MIN', width: 4 },
  { key: 'PTS', label: 'PTS', width: 4 },
  { key: 'FG',  label: 'FG',  width: 6 },
  { key: '3PT', label: '3PT', width: 5 },
  { key: 'FT',  label: 'FT',  width: 5 },
  { key: 'REB', label: 'REB', width: 4 },
  { key: 'AST', label: 'AST', width: 4 },
  { key: 'STL', label: 'STL', width: 4 },
  { key: 'BLK', label: 'BLK', width: 4 },
  { key: '+/-', label: '+/-', width: 5 },
];

async function main() {
  const eventId = process.argv[2];
  if (!eventId) {
    process.stderr.write('Usage: nba-box <eventId>\n');
    process.stderr.write("Run 'nba-games' to find today's eventIds.\n");
    process.exit(2);
  }

  let payload;
  try {
    const r = await espn.fetchSummary(eventId);
    payload = r.payload;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`Failed to fetch summary for event ${eventId}: ${msg}\n`);
    process.exit(1);
  }

  const { teams, state } = espn.normalizeBoxscore(payload);

  if (state === 'pre') {
    process.stderr.write(`Game ${eventId} hasn't started yet — no box score available.\n`);
    process.exit(1);
  }

  if (!teams.length || teams.every((t) => t.players.length === 0 && t.dnp.length === 0)) {
    process.stderr.write(`No box score data for event ${eventId}.\n`);
    process.exit(1);
  }

  const lines = [];
  for (let i = 0; i < teams.length; i++) {
    if (i > 0) lines.push('');
    lines.push(...formatTeam(teams[i]));
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function formatTeam(team) {
  const lines = [];
  const heading = team.name || team.abbr || 'Team';
  lines.push(`${heading} · ${team.score}`);

  const nameWidth = Math.max(
    'PLAYER'.length,
    ...team.players.map((p) => p.name.length)
  );

  const header = [
    'PLAYER'.padEnd(nameWidth),
    ...COLUMNS.map((c) => c.label.padStart(c.width)),
  ].join('  ');
  lines.push(header);

  for (const p of team.players) {
    const cells = COLUMNS.map((c) => {
      const v = p.stats[c.key] != null ? String(p.stats[c.key]) : '';
      return v.padStart(c.width);
    });
    lines.push([p.name.padEnd(nameWidth), ...cells].join('  '));
  }

  if (team.dnp.length > 0) {
    const dnpNames = team.dnp.map((d) => d.name).join(', ');
    lines.push(`DNP: ${dnpNames}`);
  }

  return lines;
}

main();

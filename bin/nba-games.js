#!/usr/bin/env node
'use strict';

const espn = require('../lib/espn');

async function main() {
  try {
    const r = await espn.fetchScoreboard();
    const games = espn.normalizeGames(r.payload);

    const out = {
      games: games.map((g) => ({
        id: g.id,
        away: g.away.abbr,
        awayName: g.away.name,
        awayScore: g.away.score,
        home: g.home.abbr,
        homeName: g.home.name,
        homeScore: g.home.score,
        state: g.state,
        shortDetail: g.shortDetail,
        startISO: g.startISO,
      })),
    };
    if (r.staleAt) out.staleAt = r.staleAt;

    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stdout.write(JSON.stringify({ games: [], error: msg }) + '\n');
  }
}

main();

#!/usr/bin/env node
'use strict';

const espn = require('../lib/espn');

const STDIN_TIMEOUT_MS = 150;

const noColor = process.env.NO_COLOR != null && process.env.NO_COLOR !== '';
const maxGames = (() => {
  const n = parseInt(process.env.NBA_STATUSLINE_MAX || '6', 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
})();

const ansi = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = (s) => ansi('1', s);
const dim = (s) => ansi('2', s);
const red = (s) => ansi('31', s);

async function main() {
  try {
    await drainStdin();

    let payload;
    let staleAt = 0;
    try {
      const r = await espn.fetchScoreboard();
      payload = r.payload;
      staleAt = r.staleAt || 0;
    } catch (_) {
      process.stdout.write('🏀 NBA scores unavailable\n');
      return;
    }

    const games = espn.normalizeGames(payload);
    if (games.length === 0) {
      process.stdout.write('🏀 No NBA games today\n');
      return;
    }

    const sorted = sortGames(games).slice(0, maxGames);
    const lines = sorted.map(formatGame);
    if (staleAt) {
      lines.push(dim(`(cached ${formatAgo(Date.now() - staleAt)})`));
    }
    process.stdout.write(lines.join('\n') + '\n');
  } catch (_) {
    process.stdout.write('🏀 nba-statusline error\n');
  }
}

function drainStdin() {
  if (process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
        process.stdin.pause();
      } catch (_) {}
      resolve();
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    process.stdin.on('data', () => {});
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
    try { process.stdin.resume(); } catch (_) {}
  });
}

function sortGames(games) {
  const order = { in: 0, pre: 1, post: 2 };
  return games.slice().sort((a, b) => {
    const oa = order[a.state] ?? 3;
    const ob = order[b.state] ?? 3;
    if (oa !== ob) return oa - ob;
    const da = a.startISO ? Date.parse(a.startISO) : Number.POSITIVE_INFINITY;
    const db = b.startISO ? Date.parse(b.startISO) : Number.POSITIVE_INFINITY;
    return da - db;
  });
}

function formatGame(g) {
  const aAbbr = g.away.abbr.padEnd(3);
  const hAbbr = g.home.abbr.padEnd(3);
  const aScore = g.away.score.padStart(3);
  const hScore = g.home.score.padStart(3);

  if (g.state === 'in') {
    const qStr =
      g.period > 4
        ? g.period === 5
          ? 'OT'
          : `OT${g.period - 4}`
        : `Q${g.period || 1}`;
    const aPart = isLeading(g.away, g.home) ? bold(aScore) : aScore;
    const hPart = isLeading(g.home, g.away) ? bold(hScore) : hScore;
    const prefix = noColor ? '🏀 ' : `${red('●')} `;
    return `${prefix}${aAbbr} ${aPart} - ${hPart} ${hAbbr} · ${qStr} ${g.clock}`;
  }
  if (g.state === 'post') {
    const suffix =
      g.period > 4
        ? g.period === 5
          ? 'Final/OT'
          : `Final/OT${g.period - 4}`
        : 'Final';
    const aPart = isLeading(g.away, g.home) ? bold(aScore) : aScore;
    const hPart = isLeading(g.home, g.away) ? bold(hScore) : hScore;
    return dim(`🏀 ${aAbbr} ${aPart} - ${hPart} ${hAbbr} · ${suffix}`);
  }
  const time = g.startISO ? formatLocalTime(g.startISO) : g.shortDetail || 'TBD';
  return `🏀 ${aAbbr} @ ${hAbbr} · ${time}`;
}

function isLeading(a, b) {
  const av = parseInt(a.score, 10);
  const bv = parseInt(b.score, 10);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
  return av > bv;
}

function formatLocalTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch (_) {
    return '';
  }
}

function formatAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m ago';
  if (m === 1) return '1m ago';
  return `${m}m ago`;
}

main();

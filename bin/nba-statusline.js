#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const NBA_CDN_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const CACHE_DIR = path.join(os.tmpdir(), 'nba-statusline');
const CACHE_FILE = path.join(CACHE_DIR, 'scores.json');
const CACHE_TMP = path.join(CACHE_DIR, 'scores.json.tmp');
const FETCH_TIMEOUT_MS = 1500;
const STDIN_TIMEOUT_MS = 150;
const TTL_LIVE_MS = 25_000;
const TTL_IDLE_MS = 5 * 60_000;
const VERSION = '0.1.0';

const noColor = process.env.NO_COLOR != null && process.env.NO_COLOR !== '';
const maxGames = (() => {
  const n = parseInt(process.env.NBA_STATUSLINE_MAX || '6', 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
})();
const fixture = process.env.NBA_STATUSLINE_FIXTURE;
const useBackup = process.env.NBA_STATUSLINE_BACKUP === 'nbacdn';

const ansi = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = (s) => ansi('1', s);
const dim = (s) => ansi('2', s);
const red = (s) => ansi('31', s);

async function main() {
  try {
    await drainStdin();

    let payload;
    let staleAt = 0;

    if (fixture) {
      payload = await fetchPayload();
    } else {
      const cached = readCacheIfFresh();
      if (cached) {
        payload = cached;
      } else {
        try {
          payload = await fetchPayload();
          writeCacheAtomic(payload);
        } catch (_) {
          const stale = readCacheRaw();
          if (stale && stale.payload) {
            payload = stale.payload;
            staleAt = stale.fetchedAt || 0;
          } else {
            process.stdout.write('🏀 NBA scores unavailable\n');
            return;
          }
        }
      }
    }

    const games = normalizeGames(payload);
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

async function fetchPayload() {
  if (fixture) {
    const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', `${fixture}.json`);
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }
  const url = useBackup ? NBA_CDN_URL : ESPN_URL;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': `nba-statusline/${VERSION}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function readCacheRaw() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function readCacheIfFresh() {
  const raw = readCacheRaw();
  if (!raw || !raw.payload || !raw.fetchedAt) return null;
  const games = normalizeGames(raw.payload);
  const hasLive = games.some((g) => g.state === 'in');
  const ttl = hasLive ? TTL_LIVE_MS : TTL_IDLE_MS;
  return Date.now() - raw.fetchedAt < ttl ? raw.payload : null;
}

function writeCacheAtomic(payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_TMP, JSON.stringify({ fetchedAt: Date.now(), payload }));
    fs.renameSync(CACHE_TMP, CACHE_FILE);
  } catch (_) {}
}

function normalizeGames(payload) {
  const events = payload && payload.events;
  if (!Array.isArray(events)) return [];
  const games = [];
  for (const e of events) {
    const c = e.competitions && e.competitions[0];
    if (!c || !Array.isArray(c.competitors) || c.competitors.length < 2) continue;
    const home = c.competitors.find((x) => x.homeAway === 'home');
    const away = c.competitors.find((x) => x.homeAway === 'away');
    if (!home || !away) continue;
    const status = c.status || {};
    const type = status.type || {};
    games.push({
      home: {
        abbr: (home.team && home.team.abbreviation) || '???',
        score: home.score != null ? String(home.score) : '',
      },
      away: {
        abbr: (away.team && away.team.abbreviation) || '???',
        score: away.score != null ? String(away.score) : '',
      },
      state: type.state || 'pre',
      shortDetail: type.shortDetail || '',
      period: status.period || 0,
      clock: status.displayClock || '',
      startISO: e.date || null,
    });
  }
  return games;
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

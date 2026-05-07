'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const NBA_CDN_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const CACHE_DIR = path.join(os.tmpdir(), 'nba-statusline');
const SCORES_CACHE = path.join(CACHE_DIR, 'scores.json');
const FETCH_TIMEOUT_MS = 1500;
const TTL_LIVE_MS = 25_000;
const TTL_PRE_BUFFER_MS = 30_000;
const TTL_MAX_IDLE_MS = 6 * 60 * 60_000;
const TTL_BOX_LIVE_MS = 25_000;
const TTL_BOX_FINAL_MS = 24 * 60 * 60_000;
const VERSION = '0.2.0';

const useBackup = process.env.NBA_STATUSLINE_BACKUP === 'nbacdn';
const fixture = process.env.NBA_STATUSLINE_FIXTURE;

async function fetchScoreboard() {
  if (fixture) {
    const fpath = path.join(__dirname, '..', 'tests', 'fixtures', `${fixture}.json`);
    return {
      payload: JSON.parse(fs.readFileSync(fpath, 'utf8')),
      fromCache: false,
      staleAt: 0,
    };
  }

  const cached = readCacheRaw(SCORES_CACHE);
  if (cached && cached.refreshAfter && Date.now() < cached.refreshAfter) {
    return { payload: cached.payload, fromCache: true, staleAt: 0 };
  }

  try {
    const payload = await fetchUrl(useBackup ? NBA_CDN_URL : SCOREBOARD_URL);
    const refreshAfter = computeScoresRefreshAfter(normalizeGames(payload));
    writeCacheAtomic(SCORES_CACHE, { fetchedAt: Date.now(), refreshAfter, payload });
    return { payload, fromCache: false, staleAt: 0 };
  } catch (err) {
    if (cached && cached.payload) {
      return { payload: cached.payload, fromCache: true, staleAt: cached.fetchedAt || 0 };
    }
    throw err;
  }
}

async function fetchSummary(eventId) {
  if (fixture === 'boxscore' || fixture === 'box') {
    const fpath = path.join(__dirname, '..', 'tests', 'fixtures', 'boxscore.json');
    return {
      payload: JSON.parse(fs.readFileSync(fpath, 'utf8')),
      fromCache: false,
      staleAt: 0,
    };
  }

  const cacheFile = path.join(CACHE_DIR, `box-${String(eventId).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  const cached = readCacheRaw(cacheFile);
  if (cached && cached.refreshAfter && Date.now() < cached.refreshAfter) {
    return { payload: cached.payload, fromCache: true, staleAt: 0 };
  }

  try {
    const url = `${SUMMARY_URL}?event=${encodeURIComponent(eventId)}`;
    const payload = await fetchUrl(url);
    const state = payload && payload.header && payload.header.competitions
      && payload.header.competitions[0] && payload.header.competitions[0].status
      && payload.header.competitions[0].status.type
      && payload.header.competitions[0].status.type.state;
    const ttl = state === 'in' ? TTL_BOX_LIVE_MS
      : state === 'post' ? TTL_BOX_FINAL_MS
      : TTL_MAX_IDLE_MS;
    writeCacheAtomic(cacheFile, { fetchedAt: Date.now(), refreshAfter: Date.now() + ttl, payload });
    return { payload, fromCache: false, staleAt: 0 };
  } catch (err) {
    if (cached && cached.payload) {
      return { payload: cached.payload, fromCache: true, staleAt: cached.fetchedAt || 0 };
    }
    throw err;
  }
}

async function fetchUrl(url) {
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

function readCacheRaw(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeCacheAtomic(file, content) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(content));
    fs.renameSync(tmp, file);
  } catch (_) {}
}

function computeScoresRefreshAfter(games) {
  const now = Date.now();
  if (games.some((g) => g.state === 'in')) return now + TTL_LIVE_MS;
  const upcoming = games
    .filter((g) => g.state === 'pre' && g.startISO)
    .map((g) => Date.parse(g.startISO))
    .filter((t) => Number.isFinite(t) && t > now);
  if (upcoming.length > 0) {
    const next = Math.min(...upcoming);
    return Math.min(next + TTL_PRE_BUFFER_MS, now + TTL_MAX_IDLE_MS);
  }
  return now + TTL_MAX_IDLE_MS;
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
      id: e.id || null,
      home: {
        abbr: (home.team && home.team.abbreviation) || '???',
        name: (home.team && (home.team.displayName || home.team.name)) || '',
        score: home.score != null ? String(home.score) : '',
      },
      away: {
        abbr: (away.team && away.team.abbreviation) || '???',
        name: (away.team && (away.team.displayName || away.team.name)) || '',
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

function normalizeBoxscore(summary) {
  const bx = summary && summary.boxscore;
  if (!bx || !Array.isArray(bx.players)) return { teams: [], state: null };

  const state = summary && summary.header && summary.header.competitions
    && summary.header.competitions[0] && summary.header.competitions[0].status
    && summary.header.competitions[0].status.type
    && summary.header.competitions[0].status.type.state;

  const teams = bx.players.map((teamBlock) => {
    const team = teamBlock.team || {};
    const stats = (teamBlock.statistics && teamBlock.statistics[0]) || {};
    const names = Array.isArray(stats.names) ? stats.names : [];
    const athletes = Array.isArray(stats.athletes) ? stats.athletes : [];

    const players = [];
    const dnp = [];

    for (const a of athletes) {
      const playerName = a.athlete && a.athlete.displayName;
      if (!playerName) continue;

      const s = Array.isArray(a.stats) ? a.stats : [];
      const isDnp =
        a.didNotPlay === true ||
        s.length === 0 ||
        s.every((v) => v === '--' || v === '' || v == null) ||
        s[0] === 'DNP';

      if (isDnp) {
        dnp.push({
          name: playerName,
          reason: a.reason || null,
        });
        continue;
      }

      const dict = {};
      for (let i = 0; i < names.length; i++) {
        dict[names[i]] = s[i] != null ? String(s[i]) : '';
      }
      players.push({ name: playerName, stats: dict });
    }

    return {
      id: team.id || null,
      abbr: team.abbreviation || '',
      name: team.displayName || team.name || '',
      score: getTeamScoreFromSummary(summary, team.id),
      statNames: names,
      players,
      dnp,
    };
  });

  return { teams, state };
}

function getTeamScoreFromSummary(summary, teamId) {
  const competitors =
    summary && summary.header && summary.header.competitions
      && summary.header.competitions[0] && summary.header.competitions[0].competitors;
  if (!Array.isArray(competitors) || !teamId) return '';
  for (const c of competitors) {
    if (c.team && String(c.team.id) === String(teamId)) {
      return c.score != null ? String(c.score) : '';
    }
  }
  return '';
}

module.exports = {
  fetchScoreboard,
  fetchSummary,
  normalizeGames,
  normalizeBoxscore,
  VERSION,
};

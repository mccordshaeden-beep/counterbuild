// "My stats": your public match history from the Deadlock data service, by Steam ID.
const API = 'https://api.deadlock-api.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

async function getJSON(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? 'too many requests (429), try again in a minute' : `error ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Pure summary of a match history, newest first. Exported for testing.
export function summarize(history) {
  const games = (history || [])
    .filter((m) => m && m.match_id && num(m.match_duration_s) > 120)
    .map((m) => ({
      id: m.match_id, hero: num(m.hero_id), start: num(m.start_time), dur: num(m.match_duration_s),
      won: m.match_result != null && m.player_team != null ? num(m.match_result) === num(m.player_team) : null,
      k: num(m.player_kills), d: num(m.player_deaths), a: num(m.player_assists),
      souls: num(m.net_worth), lh: num(m.last_hits),
      mode: num(m.match_mode) === 4 ? 'Ranked' : num(m.match_mode) === 1 ? 'Unranked' : '',
      left: num(m.abandoned_time_s) > 0,
      badge: num(m.ranked_display_badge ?? m.ranked_badge ?? m.player_rank_badge),
    }))
    .sort((a, b) => b.start - a.start);

  const sum = (list) => {
    const known = list.filter((g) => g.won != null);
    const wins = known.filter((g) => g.won).length;
    const k = list.reduce((a, g) => a + g.k, 0), d = list.reduce((a, g) => a + g.d, 0), as = list.reduce((a, g) => a + g.a, 0);
    const mins = list.reduce((a, g) => a + g.dur / 60, 0);
    return {
      games: list.length, wins, losses: known.length - wins,
      wr: known.length ? wins / known.length : null,
      kda: (k + as) / Math.max(1, d), k: k / (list.length || 1), d: d / (list.length || 1), a: as / (list.length || 1),
      spm: mins ? list.reduce((a, g) => a + g.souls, 0) / mins : 0,
    };
  };

  const byHero = new Map();
  for (const g of games) { if (!byHero.has(g.hero)) byHero.set(g.hero, []); byHero.get(g.hero).push(g); }
  const heroes = [...byHero.entries()].map(([hero, list]) => ({ hero, ...sum(list) })).sort((a, b) => b.games - a.games);

  // Hero mastery: how much you play a hero, how well you win on it (few games count less) and your KDA.
  const allWr = sum(games).wr ?? 0.5;
  for (const h of heroes) {
    const shrunk = ((h.wr ?? allWr) * h.games + allWr * 10) / (h.games + 10);
    h.mastery = Math.min(40, h.games * 2) + (shrunk - 0.5) * 200 + Math.min(20, h.kda * 4);
    h.grade = h.mastery >= 70 ? 'S' : h.mastery >= 55 ? 'A' : h.mastery >= 40 ? 'B' : h.mastery >= 25 ? 'C' : 'D';
  }
  const mastery = [...heroes].sort((a, b) => b.mastery - a.mastery);

  // Rank over time: the rank badge shown on each ranked match, oldest first. badge = tier * 10 + subrank.
  const ranked = games.filter((g) => g.badge > 0).sort((a, b) => a.start - b.start)
    .map((g) => ({ start: g.start, badge: g.badge, tier: Math.floor(g.badge / 10), sub: g.badge % 10, flat: Math.floor(g.badge / 10) * 6 + Math.max(0, (g.badge % 10) - 1), won: g.won }));

  return { all: sum(games), recent: sum(games.slice(0, 20)), heroes, mastery, ranked, games };
}

export const rankName = (badge, ranks) => {
  if (!badge) return 'Unranked';
  const tier = Math.floor(badge / 10), sub = badge % 10;
  const r = (ranks || []).find((x) => Number(x.tier) === tier);
  return `${r?.name || `Tier ${tier}`}${sub ? ` ${sub}` : ''}`;
};

function rankChart(ranked, ranks) {
  if (ranked.length < 2) return '';
  const pts = ranked.slice(-60);
  const W = 560, H = 150, L = 8, R = 8, T = 10, B = 22;
  const lo = Math.min(...pts.map((p) => p.flat)), hi = Math.max(...pts.map((p) => p.flat));
  const y0 = Math.max(0, lo - 2), y1 = hi + 2;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.flat).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - B}L${L},${H - B}Z`;
  // Gridlines at the start of each tier inside the range
  const grid = [];
  for (let t = Math.ceil(y0 / 6); t * 6 <= y1; t++) {
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(t * 6).toFixed(1)}" y2="${y(t * 6).toFixed(1)}" class="rc-grid"/>
      <text x="${W - R}" y="${(y(t * 6) - 3).toFixed(1)}" text-anchor="end" class="rc-label">${esc(rankName(t * 10 + 1, ranks).replace(/ 1$/, ''))}</text>`);
  }
  const last = pts[pts.length - 1];
  const fmt = (s) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<svg class="rank-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rank over your last ${pts.length} ranked games, now ${esc(rankName(last.badge, ranks))}">
    ${grid.join('')}
    <path d="${area}" class="rc-area"/><path d="${line}" class="rc-line"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.flat).toFixed(1)}" r="4" class="rc-dot"/>
    <text x="${L}" y="${H - 6}" class="rc-label">${fmt(pts[0].start)}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" class="rc-label">${fmt(last.start)}</text>
  </svg>`;
}

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const ago = (unix) => {
  const s = Date.now() / 1000 - unix;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function loadMyStats(accountId, { heroById, face, onPickHero, el, fresh = false, ranks = [], who = 'you' }) {
  el.innerHTML = `<p class="empty-note">${fresh ? 'Asking Steam for your newest matches. This can take up to a minute…' : 'Loading your matches…'}</p>`;
  let history, profile = null, refetchFailed = null;
  const base = `${API}/v1/players/${accountId}/match-history`;
  // fresh: the service asks Steam directly instead of waiting for its regular update. Falls back to the normal list.
  const historyReq = fresh
    ? getJSON(`${base}?force_refetch=true`, 90000).catch((e) => { refetchFailed = /429|too many/.test(e.message) ? 'busy' : 'error'; return getJSON(base); })
    : getJSON(base);
  try {
    const [h, p] = await Promise.all([
      historyReq,
      getJSON(`${API}/v1/players/steam?account_ids=${accountId}`).catch(() => null),
    ]);
    history = Array.isArray(h) ? h : h?.matches || h?.history || [];
    profile = Array.isArray(p) ? p[0] : p;
  } catch (e) {
    el.innerHTML = `<p class="warn">Couldn't load your stats (${esc(e.message)}).</p>`;
    return null;
  }
  const s = summarize(history);
  if (!s.games.length) {
    el.innerHTML = `<p class="warn">No matches found for this Steam ID yet. If you just started playing, they can take a while to show up. Also check that the Steam profile and game details are public.</p>`;
    return null;
  }

  const name = profile?.personaname;
  const avatar = profile?.avatarmedium || profile?.avatar || profile?.avatarfull;
  const form = s.games.slice(0, 20).map((g) => `<i class="${g.won == null ? '' : g.won ? 'w' : 'l'}" title="${g.won ? 'Win' : 'Loss'} · ${esc(heroById.get(g.hero)?.name || '')}"></i>`).join('');

  const heroRows = s.mastery.slice(0, 12).map((h) => {
    const hero = heroById.get(h.hero);
    return `<tr>
      <td><button class="hero-link" data-pick="${h.hero}" title="Build for ${esc(hero?.name || '')}">${face(hero)}<span>${esc(hero?.name || 'Unknown')}</span></button></td>
      <td><span class="grade g-${h.grade}">${h.grade}</span></td>
      <td>${h.games}</td><td class="${h.wr == null ? '' : h.wr >= 0.5 ? 'good' : 'bad'}">${pct(h.wr)}</td>
      <td>${h.kda.toFixed(2)}</td><td>${Math.round(h.spm).toLocaleString()}</td></tr>`;
  }).join('');

  const gameRows = s.games.slice(0, 10).map((g) => {
    const hero = heroById.get(g.hero);
    return `<li class="${g.won == null ? '' : g.won ? 'w' : 'l'}">
      ${face(hero)}
      <span class="g-main"><b>${g.won == null ? '—' : g.won ? 'Win' : 'Loss'}</b> ${esc(hero?.name || '')}${g.mode ? ` <em>${g.mode}</em>` : ''}${g.left ? ' <em>left early</em>' : ''}</span>
      <span class="g-kda">${g.k}/${g.d}/${g.a}</span>
      <span class="g-souls">${g.souls.toLocaleString()}</span>
      <span class="g-when">${mmss(g.dur)} · ${ago(g.start)}</span>
    </li>`;
  }).join('');

  const newest = s.games[0];
  const nowRank = s.ranked[s.ranked.length - 1];
  const first20 = s.ranked[Math.max(0, s.ranked.length - 21)];
  const moved = nowRank && first20 ? nowRank.flat - first20.flat : 0;
  const rankBlock = nowRank ? `<h3 class="me-sub">Rank over time <small>last ${Math.min(60, s.ranked.length)} ranked games</small></h3>
    <div class="rank-now"><b>${esc(rankName(nowRank.badge, ranks))}</b>
      <span class="${moved > 0 ? 'good' : moved < 0 ? 'bad' : ''}">${moved > 0 ? `up ${moved} step${moved > 1 ? 's' : ''}` : moved < 0 ? `down ${-moved} step${moved < -1 ? 's' : ''}` : 'no change'} over the last ${Math.min(20, s.ranked.length - 1)} ranked games</span></div>
    ${rankChart(s.ranked, ranks)}`
    : `<h3 class="me-sub">Rank over time</h3><p class="empty-note">No ranked games with a rank shown yet.</p>`;
  el.innerHTML = `
    <p class="hint fresh-note">${refetchFailed === 'busy' ? 'The Steam check is used up for now (it\'s shared by everyone using the stats service), so this is the regular list. ' : refetchFailed ? 'Steam didn\'t answer, so this is the regular list. ' : fresh ? 'Checked with Steam just now. ' : ''}Newest match: ${ago(newest.start)}.</p>
    ${name ? `<div class="me-head">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}<b>${esc(name)}</b></div>` : ''}
    <div class="me-tiles">
      <div><span>Record</span><b>${s.all.wins}–${s.all.losses}</b><small>${s.all.games.toLocaleString()} games</small></div>
      <div><span>Win rate</span><b>${pct(s.all.wr)}</b><small>last 20: ${pct(s.recent.wr)}</small></div>
      <div><span>KDA</span><b>${s.all.kda.toFixed(2)}</b><small>${s.all.k.toFixed(1)} / ${s.all.d.toFixed(1)} / ${s.all.a.toFixed(1)}</small></div>
      <div><span>Souls / min</span><b>${Math.round(s.all.spm).toLocaleString()}</b><small>last 20: ${Math.round(s.recent.spm).toLocaleString()}</small></div>
    </div>
    <h3 class="me-sub">Last 20 games <small>newest first</small></h3>
    <div class="form" aria-label="Wins and losses, newest first">${form}</div>
    ${rankBlock}
    <h3 class="me-sub">Hero mastery <small>${who === 'you' ? 'tap one to build for it' : 'their best heroes'}</small></h3>
    <div class="table-wrap"><table class="me-heroes">
      <thead><tr><th>Hero</th><th>Grade</th><th>Games</th><th>Win</th><th>KDA</th><th>Souls/min</th></tr></thead>
      <tbody>${heroRows}</tbody></table></div>
    <p class="hint">Grade mixes how much ${who === 'you' ? 'you\'ve' : 'they\'ve'} played a hero, the win rate on it (few games count less) and KDA.</p>
    <h3 class="me-sub">Recent matches <small>K/D/A · souls</small></h3>
    <ol class="games">${gameRows}</ol>`;

  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => onPickHero(Number(b.dataset.pick))));
  return s;
}

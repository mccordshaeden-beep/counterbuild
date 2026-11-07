// "My stats": your public match history from the Deadlock data service, by Steam ID.
const API = 'https://api.deadlock-api.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

async function getJSON(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? 'too many requests, try again in a minute' : `error ${r.status}`);
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

  return { all: sum(games), recent: sum(games.slice(0, 20)), heroes, games };
}

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const ago = (unix) => {
  const s = Date.now() / 1000 - unix;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function loadMyStats(accountId, { heroById, face, onPickHero, el, fresh = false }) {
  el.innerHTML = `<p class="empty-note">${fresh ? 'Asking Steam for your newest matches. This can take up to a minute…' : 'Loading your matches…'}</p>`;
  let history, profile = null, refetchFailed = false;
  const base = `${API}/v1/players/${accountId}/match-history`;
  // fresh: the service asks Steam directly instead of waiting for its regular update. Falls back to the normal list.
  const historyReq = fresh
    ? getJSON(`${base}?force_refetch=true`, 90000).catch(() => { refetchFailed = true; return getJSON(base); })
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
    el.innerHTML = '<p class="warn">No matches found for this Steam ID yet. If you just started playing, they can take a while to show up. Also check that your Steam profile and game details are public.</p>';
    return null;
  }

  const name = profile?.personaname;
  const avatar = profile?.avatarmedium || profile?.avatar || profile?.avatarfull;
  const form = s.games.slice(0, 20).map((g) => `<i class="${g.won == null ? '' : g.won ? 'w' : 'l'}" title="${g.won ? 'Win' : 'Loss'} · ${esc(heroById.get(g.hero)?.name || '')}"></i>`).join('');

  const heroRows = s.heroes.slice(0, 12).map((h) => {
    const hero = heroById.get(h.hero);
    return `<tr>
      <td><button class="hero-link" data-pick="${h.hero}" title="Build for ${esc(hero?.name || '')}">${face(hero)}<span>${esc(hero?.name || 'Unknown')}</span></button></td>
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
  el.innerHTML = `
    <p class="hint fresh-note">${refetchFailed ? 'Steam didn\'t answer, so this is the regular list. Try again in a few minutes. ' : ''}Newest match: ${ago(newest.start)}.</p>
    ${name ? `<div class="me-head">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}<b>${esc(name)}</b></div>` : ''}
    <div class="me-tiles">
      <div><span>Record</span><b>${s.all.wins}–${s.all.losses}</b><small>${s.all.games.toLocaleString()} games</small></div>
      <div><span>Win rate</span><b>${pct(s.all.wr)}</b><small>last 20: ${pct(s.recent.wr)}</small></div>
      <div><span>KDA</span><b>${s.all.kda.toFixed(2)}</b><small>${s.all.k.toFixed(1)} / ${s.all.d.toFixed(1)} / ${s.all.a.toFixed(1)}</small></div>
      <div><span>Souls / min</span><b>${Math.round(s.all.spm).toLocaleString()}</b><small>last 20: ${Math.round(s.recent.spm).toLocaleString()}</small></div>
    </div>
    <h3 class="me-sub">Last 20 games <small>newest first</small></h3>
    <div class="form" aria-label="Wins and losses, newest first">${form}</div>
    <h3 class="me-sub">Your heroes <small>tap one to build for it</small></h3>
    <div class="table-wrap"><table class="me-heroes">
      <thead><tr><th>Hero</th><th>Games</th><th>Win</th><th>KDA</th><th>Souls/min</th></tr></thead>
      <tbody>${heroRows}</tbody></table></div>
    <h3 class="me-sub">Recent matches <small>K/D/A · souls</small></h3>
    <ol class="games">${gameRows}</ol>`;

  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => onPickHero(Number(b.dataset.pick))));
  return s;
}

import { loadMyStats, rankName } from './mystats.js';
import { extractMatch, coach, estimateRank, AREAS } from './coach.js';
import { rankName as rName, setRankNames, initRankTips, fromFlat, flat as flatOf } from './ranks.js';
import { parseSteam } from './engine.js';

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch {} },
};

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) { const e = new Error(r.status === 429 ? 'too many requests' : `error ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

// Same hero list cache as the Build page.
async function loadHeroes() {
  const hit = store.get('c.heroes2', null);
  let raw = hit && Date.now() - hit.t < 6 * 3600e3 ? hit.v : null;
  if (!raw) {
    for (const u of [`${API}/v1/assets/heroes`, `${ASSETS}/v2/heroes`]) {
      try { raw = await getJSON(u); store.set('c.heroes2', { t: Date.now(), v: raw }); break; } catch {}
    }
    raw ??= hit?.v || [];
  }
  const img = (h) => { const i = h.images || {}; return i.icon_hero_card_webp || i.icon_hero_card || i.icon_image_small_webp || i.icon_image_small || i.minimap_image || ''; };
  return new Map(raw.filter((h) => h.name).map((h) => [h.id, { id: h.id, name: h.name, img: img(h) }]));
}

const face = (h) => (!h ? '<span class="face empty" aria-hidden="true"></span>'
  : h.img ? `<img class="face" src="${esc(h.img)}" alt="" loading="lazy">` : `<span class="face" aria-hidden="true">${esc(h.name.slice(0, 2))}</span>`);

let heroById = new Map();
let ranks = [];
let theirSummary = null;
let lastSummary = null;
let account = null;

// Each match's coaching numbers never change, so keep them once worked out.
async function matchNumbers(id, acc) {
  const key = `cm2.${acc}.${id}`; // v2 adds lobby rank and per-stat standing
  const hit = store.get(key, undefined);
  if (hit !== undefined) return hit;
  const meta = await getJSON(`${API}/v1/matches/${id}/metadata`);
  const v = extractMatch(meta, acc);
  store.set(key, v);
  return v;
}

const LEVEL = { fix: 'Fix first', work: 'Work on', good: 'Keep doing' };

let coachRun = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coachCount = () => { const v = $('coach-count').value; return v === 'all' ? Infinity : Number(v); };

async function runCoach() {
  const body = $('coach-body');
  if (!lastSummary || !account) return;
  const run = ++coachRun; // a newer pick cancels this one
  const want = coachCount();
  const games = lastSummary.games.slice(0, want);
  const results = [];
  let done = 0, failed = 0, pauses = 0, waiting = false, gaveUp = false;
  const saved = games.filter((g) => store.get(`cm2.${account}.${g.id}`, undefined) !== undefined).length;
  const show = () => {
    if (run !== coachRun) return;
    body.innerHTML = `<p class="empty-note">${waiting ? 'The stats service asked us to slow down. Waiting a few seconds, then carrying on…' : `Looking at match ${Math.min(done + 1, games.length)} of ${games.length}…`}
      ${saved ? ` <span class="hint">(${saved} saved from before)</span>` : ''}</p>
      <div class="progress" aria-hidden="true"><i style="width:${Math.round((done / Math.max(1, games.length)) * 100)}%"></i></div>`;
  };
  show();
  const queue = [...games];
  async function worker() {
    while (queue.length && !gaveUp && run === coachRun) {
      const g = queue.shift();
      try {
        const m = await matchNumbers(g.id, account);
        if (m) { if (m.won == null) m.won = g.won; results.push(m); }
        done++;
      } catch (e) {
        if (e.status === 429 && pauses < 6) { // wait it out and try the same match again
          queue.unshift(g); pauses++; waiting = true; show();
          await sleep(15000); waiting = false;
        } else { if (e.status === 429) gaveUp = true; failed++; done++; }
      }
      show();
    }
  }
  await Promise.all([worker(), worker()]);
  if (run !== coachRun) return;
  const limited = gaveUp;
  const skipped = games.length - results.length;

  const heroCount = new Set(lastSummary.games.slice(0, 20).map((g) => g.hero)).size;
  const c = coach(results, heroCount);
  $('coach-meta').textContent = `${results.length} of ${games.length} matches`;

  if (c.n < 3) {
    body.innerHTML = `<p class="warn">Couldn't get enough match details to coach you (${results.length} of ${games.length}). ${limited ? 'The stats service asked us to slow down. Try again in a minute.' : 'Try again later.'}</p>`;
    return;
  }
  const nb = c.numbers;
  const bar = (label, you, them, fmt, lowIsGood) => {
    const max = Math.max(you, them) * 1.15 || 1;
    const better = lowIsGood ? you <= them : you >= them;
    return `<div class="cmp"><span class="cmp-l">${label}</span>
      <span class="cmp-bars"><i class="you ${better ? 'good' : 'bad'}" style="width:${(you / max) * 100}%"></i><i class="them" style="width:${(them / max) * 100}%"></i></span>
      <span class="cmp-v"><b>${fmt(you)}</b><small>lobby ${fmt(them)}</small></span></div>`;
  };
  const r0 = (x) => Math.round(x).toLocaleString(), r1 = (x) => x.toFixed(1);
  body.innerHTML = guessHtml(estimateRank(results, lastSummary.all.wr)) + `
    <h3 class="me-sub">You vs the average player in your games</h3>
    <div class="cmp-wrap">
      <p class="cmp-key"><span><i class="you good"></i>You</span><span><i class="them"></i>Average player in your games</span></p>
      ${bar('Deaths a game', nb.d, nb.ld, r1, true)}
      ${bar('Souls a minute', nb.s, nb.ls, r0, false)}
      ${bar('Last hits a game', nb.lh, nb.llh, r0, false)}
      ${nb.lane != null ? `<p class="lane-note">At 10:00 you're <b class="${nb.lane >= 0 ? 'good' : 'bad'}">${r0(Math.abs(nb.lane))} souls ${nb.lane >= 0 ? 'ahead of' : 'behind'}</b> your lane opponent on average.</p>` : ''}
    </div>
    ${c.tips.length ? `<ol class="tips">${c.tips.map((t) => `<li class="tip-card lv-${t.level}">
      <span class="lv">${LEVEL[t.level]}</span>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.body)}</p>
      <p class="ev">${esc(t.evidence)}</p></li>`).join('')}</ol>`
    : '<p class="empty-note">Nothing stands out. You\'re close to the average player in your games on deaths, souls and last hits.</p>'}
    ${skipped ? `<p class="hint">${skipped} match${skipped > 1 ? 'es' : ''} couldn't be used${limited ? ' because the stats service is busy. Pick the same option again in a minute to fill them in' : ' (still processing, too short, or details missing)'}.</p>` : ''}`;
}

// ---------- rank guess ----------
function guessHtml(g) {
  if (!g || !g.areas?.length) return '';
  const current = lastSummary?.ranked?.length ? lastSummary.ranked[lastSummary.ranked.length - 1].badge : 0;
  let head = '';
  if (g.flat != null) {
    const guess = fromFlat(g.flat);
    const diff = current ? Math.round(g.flat - flatOf(current)) : null;
    const verdict = diff == null ? 'Play some ranked games to compare this with your real rank.'
      : diff >= 3 ? `That's ${diff} steps above your rank. Keep playing like this and you should climb.`
      : diff <= -3 ? `That's ${-diff} steps below your rank. Work on the areas below to hold your rank and climb again.`
      : "That's right around your rank. Improve the weak areas below to start climbing.";
    head = `<div class="guess">
      <div class="guess-main"><span>You play like</span>
        <b class="rank-link" data-rank="${guess}" tabindex="0">${esc(rName(guess))}</b></div>
      <dl class="guess-facts">
        ${current ? `<div><dt>Your rank</dt><dd><span class="rank-link" data-rank="${current}" tabindex="0">${esc(rName(current))}</span></dd></div>` : ''}
        <div><dt>Your lobbies</dt><dd><span class="rank-link" data-rank="${fromFlat(g.lobbyFlat)}" tabindex="0">${esc(rName(fromFlat(g.lobbyFlat)))}</span></dd></div>
        <div><dt>Vs your lobbies</dt><dd class="${g.perf >= 0.5 ? 'good' : 'bad'}">better than ${Math.round(g.perf * 100)}%</dd></div>
      </dl>
      <p>${verdict}</p>
      <p class="hint">A guess from ${g.n} match${g.n > 1 ? 'es' : ''}${g.confidence === 'low' ? ', so treat it loosely. Pick more games above for a better guess' : ''}. It starts at the average rank of your lobbies and moves up or down by how you did against those players, and a little by your win rate.</p>
    </div>`;
  }
  const order = { weak: 0, ok: 1, strong: 2 };
  const areas = [...g.areas].sort((a, b) => order[a.level] - order[b.level] || a.score - b.score);
  const row = (a) => {
    const A = AREAS[a.key];
    const pctTxt = a.key === 'lane' ? `ahead in ${Math.round(a.score * 100)}% of lanes` : `better than ${Math.round(a.score * 100)}% of players`;
    return `<li class="area lv-${a.level}">
      <div class="area-top"><b>${A.name}</b><span class="area-lvl">${a.level === 'strong' ? 'Strong' : a.level === 'weak' ? 'Improve' : 'Average'}</span></div>
      <div class="area-bar" aria-hidden="true"><i style="width:${Math.round(a.score * 100)}%"></i><em></em></div>
      <p class="area-note">${A.what}: ${pctTxt}.</p>
      ${a.level === 'weak' ? `<p class="area-fix">${esc(A.fix)}</p>` : ''}
    </li>`;
  };
  return `<h3 class="me-sub">Your rank guess</h3>${head}
    <h3 class="me-sub">Strengths and what to improve <small>vs the players in your games</small></h3>
    <ul class="areas">${areas.map(row).join('')}</ul>`;
}

async function loadRanks() {
  const hit = store.get('c.ranks', null);
  if (hit && Date.now() - hit.t < 24 * 3600e3) return hit.v;
  try {
    const raw = await getJSON(`${API}/v1/assets/ranks`);
    const v = (Array.isArray(raw) ? raw : []).map((r) => ({ tier: Number(r.tier), name: r.name })).filter((r) => r.name);
    store.set('c.ranks', { t: Date.now(), v });
    return v;
  } catch { return hit?.v || []; }
}

// ---------- look up another player ----------
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
function compareTable(me, them, theirName) {
  const nowRank = (s) => s?.ranked?.length ? rankName(s.ranked[s.ranked.length - 1].badge, ranks) : '—';
  const badgeOf = (s) => (s?.ranked?.length ? s.ranked[s.ranked.length - 1].badge : 0);
  const top = (s) => s?.mastery?.slice(0, 3).map((h) => heroById.get(h.hero)?.name).filter(Boolean).join(', ') || '—';
  const rows = [
    ['Rank', nowRank(me), nowRank(them), null],
    ['Win rate', pct(me?.all.wr), pct(them.all.wr), [me?.all.wr, them.all.wr, 1]],
    ['Last 20 win rate', pct(me?.recent.wr), pct(them.recent.wr), [me?.recent.wr, them.recent.wr, 1]],
    ['KDA', me?.all.kda.toFixed(2) ?? '—', them.all.kda.toFixed(2), [me?.all.kda, them.all.kda, 1]],
    ['Deaths a game', me?.all.d.toFixed(1) ?? '—', them.all.d.toFixed(1), [me?.all.d, them.all.d, -1]],
    ['Souls a minute', me ? Math.round(me.all.spm).toLocaleString() : '—', Math.round(them.all.spm).toLocaleString(), [me?.all.spm, them.all.spm, 1]],
    ['Games', me?.all.games.toLocaleString() ?? '—', them.all.games.toLocaleString(), null],
    ['Best heroes', top(me), top(them), null],
  ];
  const cls = (cmp, side) => {
    if (!cmp || cmp[0] == null || cmp[1] == null || cmp[0] === cmp[1]) return '';
    const meBetter = (cmp[0] - cmp[1]) * cmp[2] > 0;
    return (side === 'me') === meBetter ? 'better' : '';
  };
  return `<div class="table-wrap"><table class="cmp-table">
    <thead><tr><th></th><th>You</th><th>${esc(theirName)}</th></tr></thead>
    <tbody>${rows.map(([l, a, b, c]) => l === 'Rank'
      ? `<tr><th>${l}</th><td><span class="rank-link" data-rank="${badgeOf(me)}" tabindex="0">${esc(a)}</span></td><td><span class="rank-link" data-rank="${badgeOf(them)}" tabindex="0">${esc(b)}</span></td></tr>`
      : `<tr><th>${l}</th><td class="${cls(c, 'me')}">${esc(a)}</td><td class="${cls(c, 'them')}">${esc(b)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderRecent() {
  const list = store.get('lookups', []);
  $('lk-recent').innerHTML = list.map((x) => `<button class="chip" type="button" data-lk="${esc(x.id)}">${esc(x.name || x.id)}</button>`).join('');
}

async function lookUp(raw) {
  const acc = parseSteam(raw);
  const body = $('lk-body');
  if (!acc) { body.innerHTML = '<p class="warn">Paste their Steam profile link (steamcommunity.com/profiles/7656…) or the long number in it.</p>'; return; }
  if (acc === account) { body.innerHTML = '<p class="empty-note">That\'s you. Your stats are on the right.</p>'; return; }
  body.innerHTML = '<p class="empty-note">Loading their matches…</p>';
  $('me-h').textContent = 'Their stats'; $('me-back').hidden = false; $('me-fresh').hidden = true;
  theirSummary = await loadMyStats(acc, { heroById, face, el: $('me-body'), ranks, who: 'them', onPickHero: () => {} });
  if (!theirSummary) { body.innerHTML = '<p class="warn">Couldn\'t load that player. Their profile or match details may be private.</p>'; return; }
  let name = '';
  try { const p = await getJSON(`${API}/v1/players/steam?account_ids=${acc}`); name = (Array.isArray(p) ? p[0] : p)?.personaname || ''; } catch {}
  if (name) $('me-h').textContent = `${name}'s stats`;
  const list = store.get('lookups', []).filter((x) => x.id !== String(acc));
  list.unshift({ id: String(acc), name }); store.set('lookups', list.slice(0, 6)); renderRecent();
  body.innerHTML = `<h3 class="me-sub">You vs ${esc(name || 'them')}</h3>${compareTable(lastSummary, theirSummary, name || 'Them')}
    ${lastSummary ? '' : '<p class="hint">Load your own stats above to fill in your side.</p>'}`;
}

function backToMe() {
  $('me-h').textContent = 'My stats'; $('me-back').hidden = true; $('me-fresh').hidden = false;
  if (account) load(); else $('me-body').innerHTML = '<p class="empty-note">Load your stats on the left.</p>';
}

function wireLookup() {
  $('lk-form').addEventListener('submit', (e) => { e.preventDefault(); lookUp($('lk-id').value); });
  $('lk-recent').addEventListener('click', (e) => { const b = e.target.closest('[data-lk]'); if (b) { $('lk-id').value = b.dataset.lk; lookUp(b.dataset.lk); } });
  $('me-back').addEventListener('click', backToMe);
  renderRecent();
}

async function load(fresh = false) {
  const acc = parseSteam($('steam').value);
  if (!acc) { $('id-status').textContent = 'Paste your Steam profile link or the 7656… number from Steam → Account details.'; $('id-status').className = 'status bad'; return; }
  store.set('steam', $('steam').value.trim());
  $('id-status').textContent = 'Saved on this device, shared with the Build page.'; $('id-status').className = 'status good';
  account = acc;
  $('coach-body').innerHTML = '<p class="empty-note">Loading your matches…</p>';
  lastSummary = await loadMyStats(acc, {
    heroById, face, el: $('me-body'), fresh, ranks,
    onPickHero: (id) => { store.set('me', id); location.href = './'; },
  });
  if (!lastSummary) { $('coach-body').innerHTML = '<p class="empty-note">Coaching needs your match history first.</p>'; return; }
  const all = $('coach-count').querySelector('[value="all"]');
  if (all) all.textContent = `All available (${lastSummary.games.length})`;
  await runCoach();
}

async function boot() {
  $('steam').value = store.get('steam', '');
  $('id-form').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('coach-count').value = String(store.get('coachCount', '20'));
  if (!$('coach-count').value) $('coach-count').value = '20';
  $('coach-count').addEventListener('change', (e) => { store.set('coachCount', e.target.value); runCoach(); });
  // The service allows one Steam check per hour from each connection, so the button waits out the hour.
  const HOUR = 3600e3;
  const syncBtn = () => {
    const b = $('me-fresh');
    const left = store.get('freshAt', 0) + HOUR - Date.now();
    b.disabled = left > 0;
    b.textContent = left > 0 ? `Next check in ${Math.ceil(left / 60000)} min` : 'Check for new matches';
  };
  $('me-fresh').addEventListener('click', async () => {
    const b = $('me-fresh');
    b.disabled = true; b.textContent = 'Checking…';
    store.set('freshAt', Date.now());
    try { await load(true); } finally { syncBtn(); }
  });
  syncBtn(); setInterval(syncBtn, 30000);
  heroById = await loadHeroes();
  ranks = await loadRanks();
  setRankNames(ranks);
  initRankTips();
  wireLookup();
  if (parseSteam($('steam').value)) load();
}
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

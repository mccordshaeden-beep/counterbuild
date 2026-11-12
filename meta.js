// Pure math for the Meta page: tier list, lane matchups, patch movers, item win rates.
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const games = (r) => num(r.matches ?? r.matches_played ?? (num(r.wins) + num(r.losses)));
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (p) => Math.min(0.99, Math.max(0.01, p));

// hero-stats rows -> [{ hero, matches, wins, wr, adj, pick, tier }] sorted best first
export function tierList(rows, { prior = 400 } = {}) {
  const list = (rows || []).map((r) => ({ hero: num(r.hero_id), matches: games(r), wins: num(r.wins) })).filter((r) => r.hero && r.matches > 0);
  const total = list.reduce((a, r) => a + r.matches, 0);
  const lobbies = total / 12 || 1; // every match has 12 heroes
  for (const r of list) {
    r.wr = r.wins / r.matches;
    r.adj = (r.wins + prior * 0.5) / (r.matches + prior); // small samples pulled toward 50%
    r.pick = r.matches / lobbies;
  }
  list.sort((a, b) => b.adj - a.adj);
  // Tiers by position: S top 10%, A next 20%, B middle 40%, C next 20%, D bottom 10%
  const cuts = [['S', 0.1], ['A', 0.3], ['B', 0.7], ['C', 0.9], ['D', 1]];
  list.forEach((r, i) => { const p = (i + 0.5) / list.length; r.tier = cuts.find(([, c]) => p <= c)[0]; });
  return list;
}

/**
 * Lane matchups for one hero. A raw "win rate vs X" mostly measures how strong X is overall,
 * so each matchup is compared with what both heroes' overall strength predicts.
 * counterRows: hero-counter-stats rows, heroWr: Map(hero -> overall win rate)
 */
export function matchups(counterRows, heroWr, heroId, { prior = 100, minGames = 50 } = {}) {
  const wa = clamp(heroWr.get(heroId) ?? 0.5);
  return (counterRows || [])
    .filter((r) => num(r.hero_id) === heroId && num(r.enemy_hero_id) !== heroId)
    .map((r) => {
      const m = games(r), w = num(r.wins), enemy = num(r.enemy_hero_id);
      const wb = clamp(heroWr.get(enemy) ?? 0.5);
      const expected = sigmoid(logit(wa) - logit(wb));
      const shrunk = (w + prior * expected) / (m + prior);
      return { enemy, matches: m, wr: m ? w / m : null, expected, edge: shrunk - expected };
    })
    .filter((r) => r.matches >= minGames)
    .sort((a, b) => b.edge - a.edge);
}

// Two windows of rows keyed by id -> [{ id, before, now, delta, matches }] biggest change first
export function movers(nowRows, prevRows, idKey, { minGames = 300 } = {}) {
  const prev = new Map((prevRows || []).map((r) => [num(r[idKey]), r]));
  const out = [];
  for (const r of nowRows || []) {
    const p = prev.get(num(r[idKey]));
    const mn = games(r), mp = p ? games(p) : 0;
    if (mn < minGames || mp < minGames) continue;
    const now = num(r.wins) / mn, before = num(p.wins) / mp;
    out.push({ id: num(r[idKey]), now, before, delta: now - before, matches: mn });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// item-stats rows -> [{ id, matches, wr, vsTier, buy }] with each item judged against its own tier
export function itemTable(rows, items, totalPlayerGames) {
  const list = (rows || []).map((r) => ({ id: num(r.item_id), matches: games(r), wins: num(r.wins) }))
    .filter((r) => r.matches > 0 && items.get(r.id)?.tier);
  const tierAvg = {};
  for (const t of [1, 2, 3, 4]) {
    const tr = list.filter((r) => items.get(r.id).tier === t);
    const w = tr.reduce((a, r) => a + r.wins, 0), m = tr.reduce((a, r) => a + r.matches, 0);
    tierAvg[t] = m ? w / m : 0.5;
  }
  const most = Math.max(1, ...list.map((r) => r.matches));
  return list.map((r) => ({
    id: r.id, matches: r.matches, wr: r.wins / r.matches,
    vsTier: r.wins / r.matches - tierAvg[items.get(r.id).tier],
    buy: totalPlayerGames ? r.matches / totalPlayerGames : r.matches / most,
  }));
}

// Patch list -> unix seconds of the latest patch that is at least minAge old, or null
export function latestPatch(list, now = Date.now() / 1000, minAge = 2 * 86400) {
  const arr = Array.isArray(list) ? list : list?.items || list?.patches || [];
  const times = [];
  for (const p of arr) {
    const title = String(p.title || p.name || '');
    const m = title.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // "08-12-2026 Update"
    let t = m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 20) / 1000 : null;
    if (!t) {
      const raw = p.start_date ?? p.startDate ?? p.pub_date ?? p.pubDate ?? p.date ?? p.published_at;
      const d = typeof raw === 'number' ? (raw > 1e12 ? raw / 1000 : raw) : Date.parse(raw) / 1000;
      if (Number.isFinite(d)) t = d;
    }
    if (t && t <= now - minAge) times.push(t);
  }
  return times.length ? Math.max(...times) : null;
}

// Coaching: compares you with the other 11 players in your own recent matches.
// Pure functions here (testable); fetching lives in the stats page.
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const LANE_CHECK = 600; // souls compared at 10:00

function soulsAt(player, t) {
  const samples = (player?.stats || []).filter((s) => s && s.time_stamp_s != null);
  if (!samples.length) return null;
  let best = null;
  for (const s of samples) if (num(s.time_stamp_s) <= t && (!best || num(s.time_stamp_s) > num(best.time_stamp_s))) best = s;
  return best && num(best.time_stamp_s) >= t - 90 ? num(best.net_worth) : null;
}
const lastSample = (p, key) => { const s = (p?.stats || []).filter((x) => x && x[key] != null); return s.length ? num(s[s.length - 1][key]) : null; };

// One match's metadata -> the numbers coaching needs, or null if you're not in it.
export function extractMatch(meta, accountId) {
  const info = meta?.match_info || meta;
  const players = info?.players || [];
  const me = players.find((p) => num(p.account_id) === accountId);
  if (!me || players.length < 4) return null;
  const dur = num(info.duration_s ?? info.match_duration_s);
  if (dur < 300) return null;
  const mine = players.filter((p) => p.team === me.team), theirs = players.filter((p) => p.team !== me.team);
  const rank = (key, lowIsGood) => { // 1 = best in the lobby
    const v = num(me[key]);
    return 1 + players.filter((p) => (lowIsGood ? num(p[key]) < v : num(p[key]) > v)).length;
  };
  const teamKills = mine.reduce((a, p) => a + num(p.kills), 0);
  const opp = theirs.find((p) => p.assigned_lane != null && p.assigned_lane === me.assigned_lane);
  const myLane = soulsAt(me, LANE_CHECK), oppLane = opp ? soulsAt(opp, LANE_CHECK) : null;
  const dmg = (p) => lastSample(p, 'player_damage');
  const lobbyDmg = players.map(dmg).filter((x) => x != null);
  const kdaOf = (p) => (num(p.kills) + num(p.assists)) / Math.max(1, num(p.deaths));
  const others = players.filter((p) => p !== me);
  const teamShare = (p) => { const tk = players.filter((q) => q.team === p.team).reduce((a, q) => a + num(q.kills), 0); return tk ? (num(p.kills) + num(p.assists)) / tk : 0; };
  const pctOf = (fn, lowIsGood) => { const v = fn(me); const xs = others.map(fn); return xs.length ? xs.filter((x) => (lowIsGood ? v < x : v > x)).length / xs.length : null; };
  const b0 = num(info.average_badge_team0), b1 = num(info.average_badge_team1);
  const lobbyBadge = b0 && b1 ? (b0 + b1) / 2 : b0 || b1 || 0;
  // If the match doesn't say who won, the stats page fills this in from your match history.
  const won = info.winning_team != null ? num(info.winning_team) === num(me.team) : null;

  return {
    id: num(info.match_id), hero: num(me.hero_id), dur, won, lobby: players.length,
    k: num(me.kills), d: num(me.deaths), a: num(me.assists), souls: num(me.net_worth), lh: num(me.last_hits),
    lobbyDeaths: avg(players.map((p) => num(p.deaths))), lobbySouls: avg(players.map((p) => num(p.net_worth))),
    lobbyLh: avg(players.map((p) => num(p.last_hits))),
    deathRank: rank('deaths', true), soulsRank: rank('net_worth', false), lhRank: rank('last_hits', false),
    mostDeathsOnTeam: mine.every((p) => num(p.deaths) <= num(me.deaths)) && num(me.deaths) > 0,
    participation: teamKills ? (num(me.kills) + num(me.assists)) / teamKills : null,
    laneDiff: myLane != null && oppLane != null ? myLane - oppLane : null,
    earlyDeaths: (me.death_details || []).filter((x) => num(x.game_time_s ?? x.time_s) > 0 && num(x.game_time_s ?? x.time_s) < LANE_CHECK).length,
    dmg: dmg(me), lobbyDmg: lobbyDmg.length ? avg(lobbyDmg) : null,
    lobbyBadge,
    // Share of the other 11 players you beat on each stat (0 = worst in the lobby, 1 = best)
    p: {
      farm: pctOf((p) => num(p.net_worth)),
      survive: pctOf((p) => num(p.deaths), true),
      lastHits: pctOf((p) => num(p.last_hits)),
      fight: pctOf(kdaOf),
      damage: dmg(me) != null && lobbyDmg.length > 6 ? pctOf((p) => dmg(p) ?? 0) : null,
      teamplay: pctOf(teamShare),
    },
    laneAhead: myLane != null && oppLane != null ? myLane > oppLane : null,
  };
}

const f1 = (x) => x.toFixed(1);
const pct = (x) => Math.round(x * 100) + '%';

// Matches -> { numbers, tips[] }. Each tip: { level: 'fix'|'work'|'good', title, body, evidence }
export function coach(matches, heroCount = null) {
  const ms = matches.filter(Boolean);
  if (ms.length < 3) return { tips: [], n: ms.length };
  const n = ms.length;
  const d = avg(ms.map((m) => m.d)), ld = avg(ms.map((m) => m.lobbyDeaths));
  const s = avg(ms.map((m) => m.souls / (m.dur / 60))), ls = avg(ms.map((m) => m.lobbySouls / (m.dur / 60)));
  const lh = avg(ms.map((m) => m.lh)), llh = avg(ms.map((m) => m.lobbyLh));
  const deathRank = avg(ms.map((m) => m.deathRank)), soulsRank = avg(ms.map((m) => m.soulsRank));
  const mostDeaths = ms.filter((m) => m.mostDeathsOnTeam).length / n;
  const parts = ms.map((m) => m.participation).filter((x) => x != null), part = parts.length ? avg(parts) : null;
  const lanes = ms.map((m) => m.laneDiff).filter((x) => x != null), lane = lanes.length >= 3 ? avg(lanes) : null;
  const early = avg(ms.map((m) => m.earlyDeaths));
  const dmgs = ms.filter((m) => m.dmg != null && m.lobbyDmg), dmgRatio = dmgs.length >= 3 ? avg(dmgs.map((m) => m.dmg / m.lobbyDmg)) : null;
  const tips = [];
  const of12 = (r) => `${f1(r)} out of ${Math.round(avg(ms.map((m) => m.lobby)))}`;

  // Deaths
  if (d > ld * 1.2 || deathRank > 8) {
    tips.push({ level: 'fix', title: 'Play further back',
      body: 'You die more than most players in your games. Stay behind your frontline, keep a movement ability or stamina ready to escape, and back off when the enemy goes missing from the map. Pick up a vitality item earlier in your build.',
      evidence: `${f1(d)} deaths a game vs ${f1(ld)} for the lobby. Your death count ranks ${of12(deathRank)} on average (1 = fewest).${mostDeaths >= 0.4 ? ` Most deaths on your team in ${pct(mostDeaths)} of games.` : ''}` });
  } else if (d < ld * 0.8) {
    tips.push({ level: 'good', title: 'You stay alive', body: 'You die less than most of your lobby. Keep it up; you can afford to take slightly more fights when your team is grouped.',
      evidence: `${f1(d)} deaths a game vs ${f1(ld)} for the lobby.` });
  }
  if (early >= 1.5) {
    tips.push({ level: 'fix', title: 'Safer laning', body: 'You die a lot before 10:00. In lane, stay near your guardian when the enemy has more health, watch for the other lane rotating to you, and don\'t chase past the middle of the lane.',
      evidence: `${f1(early)} deaths before 10:00 per game.` });
  }

  // Souls
  if (s < ls * 0.9 || soulsRank > 8) {
    tips.push({ level: 'fix', title: 'Farm more souls',
      body: 'You end with fewer souls than most players. Last-hit every creep and shoot the soul orb, deny theirs, clear small camps between waves, and break crates on your way. Never leave a wave unpushed when you leave lane.',
      evidence: `${Math.round(s)} souls a minute vs ${Math.round(ls)} for the lobby. Souls rank ${of12(soulsRank)} (1 = most).` });
  } else if (s > ls * 1.1) {
    tips.push({ level: 'good', title: 'Strong farm', body: 'You out-farm most of your lobby. Turn that lead into objectives: push towers and take Mid Boss while you\'re ahead.',
      evidence: `${Math.round(s)} souls a minute vs ${Math.round(ls)} for the lobby.` });
  }
  if (lane != null && lane < -600) {
    tips.push({ level: 'fix', title: 'Win your lane', body: 'You fall behind your lane opponent by 10:00. Focus on last hits before trades, secure the orbs from your own creeps, and only trade when the enemy walks up for a last hit.',
      evidence: `${Math.round(-lane).toLocaleString()} souls behind your lane opponent at 10:00 on average (${lanes.length} games).` });
  } else if (lane != null && lane > 600) {
    tips.push({ level: 'good', title: 'You win lanes', body: 'You\'re usually ahead of your lane opponent at 10:00. Rotate to help a losing lane or take the urn with that lead.',
      evidence: `${Math.round(lane).toLocaleString()} souls ahead at 10:00 on average.` });
  }
  if (lh < llh * 0.85) {
    tips.push({ level: 'work', title: 'More last hits', body: 'Practice last-hitting in the sandbox for a few minutes before you queue. Melee the creep when it\'s low; it\'s faster than shooting.',
      evidence: `${Math.round(lh)} last hits a game vs ${Math.round(llh)} for the lobby.` });
  }

  // Fights
  if (part != null && part < 0.45) {
    tips.push({ level: 'work', title: 'Join more fights', body: 'You\'re in less than half of your team\'s kills. After you push your wave, rotate toward fights and objectives, especially the urn and Mid Boss.',
      evidence: `In ${pct(part)} of your team's kills.` });
  } else if (part != null && part > 0.65 && s < ls) {
    tips.push({ level: 'work', title: 'Farm between fights', body: 'You show up to fights but end up behind on souls. When there\'s nothing to fight, clear a wave or a camp instead of waiting around.',
      evidence: `In ${pct(part)} of your team's kills, but ${Math.round(s)} souls a minute vs ${Math.round(ls)}.` });
  }
  if (dmgRatio != null && dmgRatio < 0.8) {
    tips.push({ level: 'work', title: 'Deal more damage', body: 'Your hero damage is below the lobby\'s. Look at your build for more damage items, and stay in fights a bit longer from a safe distance.',
      evidence: `${pct(dmgRatio)} of the average player's hero damage.` });
  }

  // What wins your games
  const withResult = ms.filter((m) => m.won != null);
  if (withResult.length >= 6) {
    const med = [...withResult].map((m) => m.d).sort((a, b) => a - b)[Math.floor(withResult.length / 2)];
    const low = withResult.filter((m) => m.d <= med), high = withResult.filter((m) => m.d > med);
    if (low.length >= 3 && high.length >= 3) {
      const wl = low.filter((m) => m.won).length / low.length, wh = high.filter((m) => m.won).length / high.length;
      if (wl - wh >= 0.15) tips.push({ level: 'work', title: 'Your deaths decide your games',
        body: 'You win far more often when you stay alive. Playing safer is the quickest way to climb.',
        evidence: `${pct(wl)} wins with ${med} or fewer deaths vs ${pct(wh)} with more.` });
    }
  }
  if (heroCount != null && heroCount > 6) {
    tips.push({ level: 'work', title: 'Play fewer heroes', body: 'Sticking to 2 or 3 heroes for a while makes you learn their timings and matchups much faster.',
      evidence: `${heroCount} different heroes in your last 20 games.` });
  }

  const order = { fix: 0, work: 1, good: 2 };
  tips.sort((a, b) => order[a.level] - order[b.level]);
  return { tips, n, numbers: { d, ld, s, ls, lh, llh, part, lane, early } };
}

// ---------- rank guess ----------
// What each stat means, and what to do when it's low.
export const AREAS = {
  farm:     { name: 'Farming', what: 'Souls collected', fix: 'Last-hit every creep and secure the orb, clear camps between waves, and break crates on the way.' },
  survive:  { name: 'Staying alive', what: 'Fewest deaths', fix: 'Stay behind your frontline, keep an escape ready, and back off when enemies go missing from the map.' },
  lastHits: { name: 'Last hits', what: 'Creeps and camps last-hit', fix: 'Melee low creeps; it is faster than shooting. Practice a few minutes in the sandbox before you queue.' },
  fight:    { name: 'Fighting', what: 'Kills and assists per death', fix: 'Take fights you can win: your team nearby, enemies low or out of position. Leave bad fights early.' },
  damage:   { name: 'Damage', what: 'Damage to heroes', fix: 'Stay in fights from a safe distance and check your build has enough damage for your hero.' },
  teamplay: { name: 'Teamplay', what: 'Share of your team\'s kills you helped with', fix: 'After pushing your wave, rotate to fights and objectives, especially the urn and Mid Boss.' },
  lane:     { name: 'Laning', what: 'Ahead of your lane opponent at 10:00', fix: 'Focus on last hits before trades and only trade when the enemy walks up for a creep.' },
};

const flatOf = (badge) => Math.floor(badge / 10) * 6 + Math.max(0, Math.round(badge % 10) - 1);

/**
 * matches: output of extractMatch. Returns null when no match has lobby ranks.
 * -> { flat, lobbyFlat, perf, n, areas: [{ key, score (0..1), n, level }], confidence }
 */
export function estimateRank(matches, winRate = null) {
  const ms = matches.filter((m) => m && m.p);
  const ranked = ms.filter((m) => m.lobbyBadge > 0);
  const areas = Object.keys(AREAS).map((key) => {
    const xs = key === 'lane'
      ? ms.map((m) => (m.laneAhead == null ? null : m.laneAhead ? 1 : 0)).filter((x) => x != null)
      : ms.map((m) => m.p[key]).filter((x) => x != null);
    const score = xs.length ? avg(xs) : null;
    return { key, score, n: xs.length, level: score == null ? null : score >= 0.6 ? 'strong' : score <= 0.42 ? 'weak' : 'ok' };
  }).filter((a) => a.n >= 3);
  if (!ranked.length || !areas.length) return { flat: null, areas, n: ms.length };

  const lobbyFlat = avg(ranked.map((m) => flatOf(m.lobbyBadge)));
  // Overall performance: average of your areas, laning counts half since it's one moment of the game.
  const weights = { lane: 0.5 };
  const wsum = areas.reduce((a, x) => a + (weights[x.key] ?? 1), 0);
  const perf = areas.reduce((a, x) => a + x.score * (weights[x.key] ?? 1), 0) / wsum;
  // Playing like the average player in your lobbies = your lobby rank. Each 10 points above
  // average is worth about two steps; winning more than you lose adds a little on top.
  const shift = Math.max(-12, Math.min(12, (perf - 0.5) * 20 + (winRate == null ? 0 : (winRate - 0.5) * 10)));
  const n = ranked.length;
  return { flat: lobbyFlat + shift, lobbyFlat, perf, shift, n, areas, confidence: n >= 15 ? 'good' : n >= 8 ? 'fair' : 'low' };
}

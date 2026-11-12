// Deadlock's ranked ladder: 11 ranks, each with 6 steps. A badge is tier * 10 + step.
// Shares of ranked players from metabot.gg (7-day window, November 2026). Names from the
// game data override these when they load, in case Valve renames a rank.
export const RANKS = [
  { tier: 1, name: 'Initiate', share: 4.42, about: 'Just starting ranked. Still learning heroes, the shop and the map.' },
  { tier: 2, name: 'Seeker', share: 8.61, about: 'Knows the basics. Lanes and last-hitting are still inconsistent.' },
  { tier: 3, name: 'Acolyte', share: 15.96, about: 'Comfortable on a few heroes. Farming and watching the map are still developing.' },
  { tier: 4, name: 'Sentinel', share: 23.24, about: 'The most common rank. Solid basics; knowing when to fight and when to farm is the next step.' },
  { tier: 5, name: 'Mystic', share: 18.21, about: 'Above the middle. Good mechanics; being consistent and on time for objectives separates the next ranks.' },
  { tier: 6, name: 'Ritualist', share: 10.64, about: 'Plays around objectives, spends souls well and rarely throws a lead.' },
  { tier: 7, name: 'Emissary', share: 7.42, about: 'Strong all-round players who punish mistakes and rotate with purpose.' },
  { tier: 8, name: 'Oracle', share: 5.93, about: 'Very strong players with sharp timing on fights, urns and Mid Boss.' },
  { tier: 9, name: 'Phantom', share: 4.04, about: 'High-level players who control the map and the pace of the game.' },
  { tier: 10, name: 'Ascendant', share: 1.36, about: 'Near the very top. Team play and decision-making are close to pro level.' },
  { tier: 11, name: 'Eternus', share: 0.17, about: 'The top of the ladder: the best players in the game.' },
];

let names = new Map(RANKS.map((r) => [r.tier, r.name]));
export function setRankNames(list) {
  for (const r of list || []) if (r && r.name && Number(r.tier) > 0) names.set(Number(r.tier), r.name);
}

export const tierOf = (badge) => Math.floor(Number(badge) / 10);
export const stepOf = (badge) => Number(badge) % 10;
// Badge -> a smooth number (6 steps per rank) and back
export const flat = (badge) => tierOf(badge) * 6 + Math.max(0, stepOf(badge) - 1);
export const fromFlat = (f) => { const v = Math.max(6, Math.min(71, Math.round(f))); return Math.floor(v / 6) * 10 + (v % 6) + 1; };

export function rankName(badge) {
  if (!badge) return 'Unranked';
  const t = tierOf(badge), s = stepOf(badge);
  return `${names.get(t) || `Rank ${t}`}${s ? ` ${s}` : ''}`;
}

// Share of ranked players at this rank or higher
export function topShare(tier) {
  return RANKS.filter((r) => r.tier >= tier).reduce((a, r) => a + r.share, 0);
}

function describe(badge) {
  const t = tierOf(badge), s = stepOf(badge);
  const r = RANKS.find((x) => x.tier === t);
  const top = topShare(t);
  return {
    title: rankName(badge),
    lines: [
      `Rank ${t} of 11${s ? `, step ${s} of 6` : ''}.`,
      r ? `About ${r.share.toFixed(1)}% of ranked players are ${names.get(t)}. ${top < 50 ? `This is the top ${top < 1 ? top.toFixed(2) : Math.round(top)}% of players.` : `${Math.round(100 - top + r.share)}% of players are at this rank or lower.`}` : '',
      r?.about || '',
      'Each rank has 6 steps. Win to move up a step; 6 is the last step before the next rank.',
    ].filter(Boolean),
  };
}

// Hover (or tap) any element with data-rank="<badge>" to read about that rank.
export function initRankTips() {
  const tip = document.createElement('div');
  tip.className = 'tip rank-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  let on = null;
  const show = (el) => {
    const badge = Number(el.dataset.rank);
    if (!badge) return;
    const d = describe(badge);
    on = el;
    tip.innerHTML = `<div class="tip-head"><div><b>${d.title}</b><span>Deadlock ranked</span></div></div>
      <div class="rank-ladder" aria-hidden="true">${RANKS.map((r) => `<i class="${r.tier === tierOf(badge) ? 'on' : ''}" style="flex:${Math.max(0.6, r.share)}" title="${names.get(r.tier)}"></i>`).join('')}</div>
      ${d.lines.map((l) => `<p class="tip-desc">${l}</p>`).join('')}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    tip.style.left = Math.min(Math.max(8, r.left), vw - w - 8) + 'px';
    let top = r.bottom + 6; if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    tip.style.top = top + 'px';
  };
  const hide = () => { tip.hidden = true; on = null; };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-rank]');
    if (el && el !== on) show(el); else if (!el) hide();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-rank]');
    if (el) { el === on && !tip.hidden ? hide() : show(el); } else hide();
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-rank]'); if (el) show(el); });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

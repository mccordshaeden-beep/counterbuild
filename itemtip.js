// Hover card for items. Any element with data-item="<id>" gets one.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * getItem(id) -> item, extra(item) -> optional HTML for one more tag (e.g. win rate).
 * tapSelector: on touch screens, tapping an element that matches it opens the card.
 */
export function initItemTips({ getItem, extra = () => '', tapSelector = '[data-item]' }) {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;

  const html = (it) => {
    const info = it.info || {};
    const kind = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' }[it.slot] || '';
    return `<div class="tip-head s-${esc(it.slot)}">
        ${it.img ? `<img src="${esc(it.img)}" alt="">` : ''}
        <div><b>${esc(it.name)}</b><span>${kind} · Tier ${it.tier} · ${it.cost.toLocaleString()} souls</span></div>
      </div>
      <div class="tip-tags"><span>${info.active ? 'Active' : 'Passive'}</span>${info.cooldown ? `<span>Cooldown ${esc(info.cooldown)}</span>` : ''}${extra(it) || ''}</div>
      ${info.stats?.length ? `<dl class="tip-stats">${info.stats.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl>` : ''}
      ${info.desc ? `<p class="tip-desc">${esc(info.desc)}</p>` : ''}
      ${!info.stats?.length && !info.desc ? '<p class="tip-desc">No details in the game data for this item.</p>' : ''}`;
  };

  function show(el) {
    const it = getItem(Number(el.dataset.item));
    if (!it) return;
    tipFor = el;
    tip.innerHTML = html(it);
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.left + 12), vw - w - 8);
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  const hide = () => { tip.hidden = true; tipFor = null; };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-item]');
    if (el && el !== tipFor) show(el);
    else if (!el && !e.target.closest('.tip')) hide();
  });
  document.addEventListener('click', (e) => { // tap on phones
    const el = e.target.closest(tapSelector);
    if (el && el.dataset.item) { el === tipFor && !tip.hidden ? hide() : show(el); }
    else if (!e.target.closest('.tip') && !e.target.closest('[data-item]')) hide();
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-item]'); if (el) show(el); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  return { show, hide };
}

// Match timer data. Times are seconds on the in-game match clock.
// Source: deadlockitembuilder.com/timers, checked against the October 2026 game version (build 6722).
// Update these numbers when a patch changes spawn times.

export const PATCH_NOTE = 'Timings from the October 2026 game version. A patch can change them.';

// Spawns on the match clock. `every` repeats on a fixed schedule.
export const EVENTS = [
  { id: 'small', group: 'camps',   name: 'Small camps',        kind: 'camp',   first: 120,
    tip: 'Clear them when your wave is pushed. They come back about 1:25 after you clear them.' },
  { id: 'snacks', group: 'snacks',  name: 'Healing snacks',     kind: 'heal',   first: 150,
    tip: 'Free healing on the map. Back again 3:00 after pickup.' },
  { id: 'crates', group: 'crates',  name: 'Crates',             kind: 'souls',  first: 180,
    tip: 'Break the ones on your path. Each comes back 3:00 after it breaks.' },
  { id: 'medium', group: 'camps',  name: 'Medium camps',       kind: 'camp',   first: 300,
    tip: 'Farm them when your lane is safe. Back about 4:50 after you clear them.' },
  { id: 'tunnel', group: 'crates',  name: 'Tunnel, Bell Tower & Sunken Plaza crates', kind: 'souls', first: 300,
    tip: 'Worth a bit more than regular crates.' },
  { id: 'bridge', group: 'bridge',  name: 'Bridge powerups',    kind: 'buff',   first: 300, every: 300,
    tip: 'Grab one when you rotate between lanes. Stat buff, no souls.' },
  { id: 'large', group: 'camps',   name: 'Large camps',        kind: 'camp',   first: 480,
    tip: 'Big souls. Take them when the enemy can\'t punish you. Back about 5:35 after clear.' },
  { id: 'sinner', group: 'sinner',  name: 'Sinner\'s Sacrifice', kind: 'buff',  first: 480,
    tip: 'Permanent stat buffs for some health. Be there when it opens.' },
  { id: 'urn', group: 'urn',     name: 'Soul Urn',           kind: 'obj',    first: 600, every: 300,
    tip: 'Huge team souls. Group up to escort or steal it. It can be late while the last urn is still being carried.' },
  { id: 'rift', group: 'rift',    name: 'Unstable Rift window', kind: 'obj',  first: 600,
    tip: 'Opens between 10:00 and 12:00. Watch for the reveal about 80 seconds early.' },
  { id: 'bosscrates', group: 'crates', name: 'Mid Boss room crates', kind: 'souls', first: 600,
    tip: 'Under Times Square. Back 3:00 after they break.' },
  { id: 'waves25', group: 'waves', name: 'Creep waves speed up', kind: 'info', first: 1200,
    tip: 'Waves now every 25 seconds. Keep lanes pushed while you group.' },
  { id: 'waves20', group: 'waves', name: 'Creep waves speed up again', kind: 'info', first: 2100,
    tip: 'Waves now every 20 seconds.' },
];

// Timers you start by tapping, because they depend on when something happened.
export const TAP_TIMERS = [
  { id: 'boss', group: 'boss',   name: 'Mid Boss', button: 'Mid Boss killed',
    respawn: (n) => [420, 360, 300][Math.min(n, 3) - 1],
    tip: 'Respawns 7:00 after the first kill, 6:00 after the second, 5:00 after that.' },
  { id: 'sinner', group: 'sinner', name: 'Sinner\'s Sacrifice', button: 'Sinner\'s used',
    respawn: () => 300, tip: 'Back about 5:00 after it is fully used.' },
  { id: 'rift', group: 'rift',   name: 'Next Rift (earliest)', button: 'Rift taken',
    respawn: () => 360, tip: 'The next Rift comes about 6 to 8 minutes later.' },
];

// What you can turn alerts on or off for, in the order shown in Alert settings.
export const ALERT_GROUPS = [
  { id: 'camps',  label: 'Jungle camps' },
  { id: 'crates', label: 'Crates (boxes)' },
  { id: 'urn',    label: 'Soul Urn' },
  { id: 'boss',   label: 'Mid Boss respawn' },
  { id: 'rift',   label: 'Unstable Rift' },
  { id: 'sinner', label: 'Sinner\'s Sacrifice' },
  { id: 'bridge', label: 'Bridge powerups' },
  { id: 'snacks', label: 'Healing snacks' },
  { id: 'waves',  label: 'Creep waves speed up' },
  { id: 'phase',  label: 'Phase changes' },
];

// General advice by stage of the match.
export const PHASES = [
  { from: 0,    title: 'Lane',
    tips: ['Last-hit every creep and deny theirs.', 'Spend souls on early items when you go back.'] },
  { from: 120,  title: 'Lane + small camps',
    tips: ['Small camps are up. Clear them when your wave is pushed in.', 'From 3:00, break crates on your way.'] },
  { from: 300,  title: 'First rotations',
    tips: ['Take a bridge powerup when you rotate.', 'Medium camps are up. Farm them when your lane is safe.'] },
  { from: 480,  title: 'Big farm',
    tips: ['Sinner\'s Sacrifice and large camps are up.', 'Get ready to group for the urn at 10:00.'] },
  { from: 600,  title: 'Objectives',
    tips: ['Urn every 5 minutes. Group to escort it or steal it.', 'Take Mid Boss when 2 or more enemies are dead or far away.', 'Watch for the Rift between 10:00 and 12:00.'] },
  { from: 1200, title: 'Late game',
    tips: ['Stay near your team. Waves come faster now.', 'Push objectives right after you win a fight.', 'Don\'t farm far jungle alone.'] },
];

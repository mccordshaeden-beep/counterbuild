// Threat tags for enemy heroes, and the shop items that answer each threat.
// Hero tags are a starting point: tap a tag on any enemy in the app to change it.
// Item names are matched against the live item list, so items that were renamed
// or removed in a patch are simply skipped.

export const TAGS = {
  heal:   { label: 'Healing',      short: 'Heal' },
  spirit: { label: 'Spirit damage', short: 'Spirit' },
  gun:    { label: 'Gun damage',   short: 'Gun' },
  cc:     { label: 'Stuns & CC',   short: 'CC' },
  dive:   { label: 'Dive & burst', short: 'Dive' },
  tank:   { label: 'Tanky',        short: 'Tank' },
};

// Lower-case hero name -> default threat tags.
export const HERO_TAGS = {
  'abrams':      ['heal', 'tank', 'cc', 'dive'],
  'bebop':       ['spirit', 'cc', 'tank'],
  'calico':      ['spirit', 'dive'],
  'dynamo':      ['spirit', 'cc', 'heal', 'tank'],
  'grey talon':  ['gun', 'spirit'],
  'haze':        ['gun', 'dive'],
  'holliday':    ['gun'],
  'infernus':    ['spirit', 'gun'],
  'ivy':         ['spirit', 'heal'],
  'kelvin':      ['spirit', 'heal', 'cc'],
  'lady geist':  ['spirit', 'heal', 'tank'],
  'lash':        ['spirit', 'cc', 'dive'],
  'mcginnis':    ['gun', 'cc'],
  'mirage':      ['gun', 'spirit', 'dive'],
  'mo & krill':  ['spirit', 'cc', 'heal', 'tank'],
  'paige':       ['spirit', 'heal'],
  'paradox':     ['spirit', 'cc'],
  'pocket':      ['spirit', 'dive'],
  'seven':       ['spirit', 'gun', 'cc'],
  'shiv':        ['gun', 'dive'],
  'sinclair':    ['spirit', 'cc'],
  'vindicta':    ['gun'],
  'viscous':     ['spirit', 'cc', 'tank'],
  'vyper':       ['gun', 'dive'],
  'warden':      ['gun', 'cc', 'tank', 'heal'],
  'wraith':      ['gun', 'spirit'],
  'yamato':      ['gun', 'dive', 'heal'],
  'fathom':      ['spirit', 'cc'],
  'mina':        ['spirit', 'dive'],
  'venator':     ['gun'],
  'victor':      ['gun', 'tank'],
  'baba':        ['spirit'],
  // Newer heroes: set from their role. Tap tags in the app to correct them as you learn them.
  'apollo':        ['gun', 'dive'],
  'billy':         ['gun', 'tank', 'dive'],
  'celeste':       ['spirit'],
  'deadman danny': ['gun'],
  'drifter':       ['gun', 'dive'],
  'graves':        ['spirit', 'cc'],
  'nurse harrow':  ['spirit', 'heal', 'cc'],
  'rat king':      ['gun', 'tank', 'dive'],
  'rem':           ['spirit'],
  'silver':        ['gun', 'tank'],
  'solomon':       ['spirit'],
  'the doorman':   ['spirit', 'cc'],
  'doorman':       ['spirit', 'cc'],
  'violet':        ['spirit'],
};

// Used when a hero has no entry above but the game data says what kind of hero it is.
export const TYPE_TAGS = {
  marksman: ['gun'],
  assassin: ['gun', 'dive'],
  brawler:  ['tank', 'dive'],
  mystic:   ['spirit'],
};

// Each threat tag -> counter items. weight = win-rate points added per enemy with that tag.
export const COUNTERS = {
  heal:   { weight: 2.2, items: ['Healbane', 'Toxic Bullets', 'Decay', 'Inhibitor'] },
  spirit: { weight: 1.4, items: ['Spirit Armor', 'Improved Spirit Armor', 'Spirit Shielding', 'Spellbreaker', 'Counterspell', 'Divine Barrier', 'Diviner\'s Kevlar'] },
  gun:    { weight: 1.4, items: ['Bullet Armor', 'Improved Bullet Armor', 'Metal Skin', 'Return Fire', 'Plated Armor', 'Battle Vest'] },
  cc:     { weight: 1.8, items: ['Debuff Remover', 'Debuff Reducer', 'Reactive Barrier', 'Unstoppable', 'Counterspell', 'Rescue Beam'] },
  dive:   { weight: 1.5, items: ['Slowing Hex', 'Knockdown', 'Curse', 'Silencer', 'Slowing Bullets', 'Silence Glyph', 'Ethereal Shift'] },
  tank:   { weight: 1.3, items: ['Escalating Exposure', 'Mystic Vulnerability', 'Crippling Headshot', 'Armor Piercer', 'Inhibitor'] },
};

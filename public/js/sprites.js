// Pixel sprites. '.' is transparent. Keep palettes small so the whole house reads as one picture.

const CLAWD_PAL = { p: '#b196ff', d: '#7c5cf0', D: '#4c2bb0', o: '#ffa047', r: '#d9641c' };

export const CLAWD_BODY = {
  id: 'clawd-body',
  pal: CLAWD_PAL,
  rows: [
    '....p......p....',
    '.....p....p.....',
    '.....pppppp.....',
    '....ppppppppd...',
    '...pppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..ppppppppppdd..',
    '..dppppppppppd..',
    '...ddppppppdd...',
    '....dpp..ppd....',
    '....dpp..ppd....',
    '...dddd..dddd...',
  ],
};
// Alternate leg frames for walking (rows 14..16 replaced).
export const CLAWD_WALK_A = { ...CLAWD_BODY, id: 'clawd-walk-a', rows: [...CLAWD_BODY.rows.slice(0, 14), '...dpp....ppd...', '..dpp......ppd..', '..ddd......ddd..'] };
export const CLAWD_WALK_B = { ...CLAWD_BODY, id: 'clawd-walk-b', rows: [...CLAWD_BODY.rows.slice(0, 14), '.....dp..pd.....', '.....dp..pd.....', '....ddd..ddd....'] };
export const CLAWD_SIT = { ...CLAWD_BODY, id: 'clawd-sit', rows: [...CLAWD_BODY.rows.slice(0, 13), '..ddppppppppdd..', '..dddd....dddd..'] };

// Pincer (opens to the right; flip for the left side).
export const CLAW = { id: 'claw', pal: CLAWD_PAL, rows: ['.oo', 'o..', '.or'] };

const DOG_PAL = { b: '#c58a3a', t: '#e8b86d', n: '#4a2e12', k: '#120c06', w: '#ffffff', r: '#ef4444' };
export const DOG_STAND = {
  id: 'dog-stand',
  pal: DOG_PAL,
  rows: [
    '..............n.',
    '.............nn.',
    '............nbbb',
    '............bkbb',
    'n...bbbbbbbbbbbb',
    '.n..bbbbbbbbbbnn',
    '..nbbbbbbbbbbbb.',
    '...bbbbbbbbbbb..',
    '...bb.....bb....',
    '...bb.....bb....',
    '...nn.....nn....',
  ],
};
export const DOG_SIT = {
  id: 'dog-sit',
  pal: DOG_PAL,
  rows: [
    '..........n.n...',
    '.........nnbnn..',
    '.........bbbbb..',
    '.........bkbbb..',
    '.........bbbbnn.',
    '.n....bbbbbbb...',
    'n.n..bbbbbbbb...',
    '.n..bbbbbbbbb...',
    '....bbbbbbbbb...',
    '....bb....bbb...',
    '....nn....nnn...',
  ],
};
export const DOG_SLEEP = {
  id: 'dog-sleep',
  pal: DOG_PAL,
  rows: [
    '............nn..',
    '...........nbbn.',
    '..bbbbbbbbbbbbbb',
    '.nbbbbbbbbbbnbbb',
    'n.bbbbbbbbbbbbb.',
    '..bbbbbbbbbbbbb.',
    '..nnnnnnnnnnnnn.',
  ],
};
export const DOG_BARK = {
  id: 'dog-bark',
  pal: DOG_PAL,
  rows: [
    '.............n..',
    '............nn..',
    '............bbbb',
    '............bkbb',
    'n...bbbbbbbbbbbb',
    '.n..bbbbbbbbbbr.',
    '..nbbbbbbbbbbbnn',
    '...bbbbbbbbbbb..',
    '...bb.....bb....',
    '...bb.....bb....',
    '...nn.....nn....',
  ],
};

const BIRD_PAL = { b: '#4f8ef7', B: '#2b5fd1', y: '#ffd23f', k: '#0f172a', o: '#ff8c42' };
export const BIRD = {
  id: 'bird',
  pal: BIRD_PAL,
  rows: [
    '..bbb...',
    '.bkbb...',
    'obbbbB..',
    '.byyybBB',
    '.byyybB.',
    '..bbbb..',
    '..o..o..',
  ],
};
export const BIRD_SING = {
  id: 'bird-sing',
  pal: BIRD_PAL,
  rows: [
    '.bbb....',
    'obkbb...',
    'o.bbbB..',
    '.byyybBB',
    '.byyybB.',
    '..bbbb..',
    '..o..o..',
  ],
};

const BOT_PAL = { g: '#b8c0cc', G: '#5b6677', c: '#22d3ee', k: '#111827', a: '#fbbf24' };
export const BOT = {
  id: 'bot',
  pal: BOT_PAL,
  rows: [
    '...a....',
    '...G....',
    '.gggggg.',
    '.gccccg.',
    '.gggggg.',
    'GggggggG',
    '.gggggg.',
    '.gggggg.',
    '..G..G..',
    '..GG.GG.',
  ],
};
export const BOT_WALK = { ...BOT, id: 'bot-walk', rows: [...BOT.rows.slice(0, 8), '.G....G.', 'GG....GG'] };

export const PLANE = {
  id: 'plane',
  pal: { w: '#e5e7eb', g: '#9ca3af', r: '#f87171' },
  rows: [
    '......w.....',
    '.....ww.....',
    'wwwwwwwwwwwg',
    'r..wwwwwww..',
    '.....ww.....',
  ],
};

export const ENVELOPE = {
  id: 'envelope',
  pal: { w: '#fefce8', l: '#a16207', r: '#ef4444' },
  rows: [
    'lllllllll',
    'lwlwwwlwl',
    'lwwlwlwwl',
    'lwwwlwwwl',
    'lwwwwwwwl',
    'lllllllll',
  ],
};

export const NOTE = {
  id: 'note',
  pal: { k: '#fde68a' },
  rows: ['...k.', '...kk', '...k.', '...k.', '.kkk.', 'kkkk.', '.kk..'],
};

export const BOOK = {
  id: 'book',
  pal: { r: '#ef4444', w: '#fef3c7', k: '#7f1d1d' },
  rows: ['rrrrrr', 'rwwwwr', 'rwwwwr', 'rwwwwr', 'kkkkkk'],
};

export const WRENCH = {
  id: 'wrench',
  pal: { s: '#cbd5e1', d: '#64748b' },
  rows: ['ss.ss', 'sssss', '.sss.', '..d..', '..d..', '..d..', '..dd.'],
};

export const WATERING_CAN = {
  id: 'can',
  pal: { s: '#94a3b8', d: '#64748b', l: '#cbd5e1' },
  rows: [
    '.....ll.',
    '....l..l',
    '..ssssss',
    'd.slssss',
    'ddssssss',
    '..dsssss',
    '..dddddd',
  ],
};

export const HEART = { id: 'heart', pal: { r: '#fb7185' }, rows: ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'] };

export const EYE_ICON = { id: 'eye', pal: { w: '#ffffff', k: '#1e1b4b', c: '#22d3ee' }, rows: ['..www..', '.wwkww.', 'wwkckww', '.wwkww.', '..www..'] };

export const SUN_RAY = { id: 'sunray', pal: { y: '#fde047' }, rows: ['y'] };

export const CREW = {
  clawd:   { color: '#b196ff', emoji: '👾' },
  hermes:  { color: '#60a5fa', emoji: '🤖' },
  wormer:  { color: '#84cc16', emoji: '🪖' },
  opus:    { color: '#f472b6', emoji: '🧠' },
  jenkins: { color: '#a8a29e', emoji: '🗿' },
  vinny:   { color: '#e2e8f0', emoji: '👻' },
  ruban:   { color: '#fb923c', emoji: '🧢' },
  you:     { color: '#fbbf24', emoji: '👑' },
};

const TAG_COLOR = {
  // Blue — Setting
  'Artsy / Creative Girl':        'blue',
  'Beach Girl':                   'blue',
  'City Girl':                    'blue',
  'Domestic / At-Home':           'blue',
  'Kitchen / Food Content':       'blue',
  'Luxury / Elevated Lifestyle':  'blue',
  'Mirror Moment':                'blue',
  'Nature / Outdoors':            'blue',
  'Travel / Adventure':           'blue',

  // Teal — Niche Identity
  'Bikini / Swim':                'teal',
  'Bookish / Smart Girl':         'teal',
  'Fitness':                      'teal',
  'Fitness / Wellness':           'teal',
  'Glam / Beauty':                'teal',
  'Musician / Singer':            'teal',
  'Tattoos':                      'teal',

  // Green — Vibe / Personality
  'Bratty / Mischievous':         'green',
  'Cute / Sweet Vibe':            'green',
  'Direct Flirt':                 'green',
  'Dominant Energy':              'green',
  'Girlfriend Vibe':              'green',
  'Girl Next Door':               'green',
  'Lifestyle Casual':             'green',
  'Playful Personality':          'green',
  'Soft Tease':                   'green',
  'Submissive / Shy Energy':      'green',
  'Toxic':                        'green',
  'Funny':                        'green',
  'Wifey':                        'green',

  // Yellow — Subject / Body
  'Body Focus':                   'yellow',
  'Boobs':                        'yellow',
  'Booty':                        'yellow',
  'Face Card / Pretty Girl':      'yellow',
  'Feet':                         'yellow',
  'Foot Fetish':                  'yellow',
  'Lingerie / Sleepwear':         'yellow',
  'Outfit Showcase':              'yellow',
  'Thirst Trap':                  'yellow',
  'Suggestive Movement':          'yellow',

  // Purple — Scenario / Viewer Dynamic
  'Eye Contact Driven':           'purple',
  'POV / Personal Attention':     'purple',
  'Personal Attention':           'purple',
  'POV':                          'purple',
  'Roleplay':                     'purple',
  'Implied Scenario':             'purple',

  // Other
  'Dance':                        'other',
  'Lipsync':                      'other',
  'Lip Sync':                     'other',
  'Car Content':                  'other',
  'Young':                        'other',
  'Viral Cut-In':                 'other',
  'Audio-Led':                    'other',
  'Clapback':                     'other',
}

const PALETTE = {
  blue:   { background: 'hsla(217, 70%, 20%, 0.75)', color: 'hsl(217, 90%, 82%)' },
  teal:   { background: 'hsla(172, 60%, 16%, 0.75)', color: 'hsl(172, 75%, 78%)' },
  green:  { background: 'hsla(142, 55%, 16%, 0.75)', color: 'hsl(142, 70%, 76%)' },
  yellow: { background: 'hsla(43, 90%, 18%, 0.75)',  color: 'hsl(43, 100%, 78%)' },
  purple: { background: 'hsla(270, 60%, 22%, 0.75)', color: 'hsl(270, 80%, 86%)' },
  other:  { background: 'hsla(220, 15%, 18%, 0.75)', color: 'hsl(220, 15%, 72%)' },
}

function hashStyle(tag) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return {
    background: `hsla(${hue}, 55%, 22%, 0.75)`,
    color: `hsl(${hue}, 80%, 78%)`,
  }
}

export function tagStyle(tag) {
  const colorKey = TAG_COLOR[tag]
  if (!colorKey) return hashStyle(tag)
  return PALETTE[colorKey]
}

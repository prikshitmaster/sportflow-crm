export const FOOTBALL_CATEGORIES = [
  {
    id: 'technical',
    label: 'Technical Ability',
    short: 'Technical',
    color: '#3b82f6',
    skills: [
      'Controlling', 'Handling Air Ball', 'Handling Low Ball',
      'Passing', 'Reaction', 'Shooting', 'Heading', 'Distribution (GK)',
    ],
  },
  {
    id: 'tactical',
    label: 'Tactical Ability',
    short: 'Tactical',
    color: '#8b5cf6',
    skills: [
      'Attacking Tactics', 'Defending Tactics', 'Game Intelligence',
      'Anticipation', 'Roles & Responsibility', 'Positioning',
    ],
  },
  {
    id: 'athleticism',
    label: 'Athleticism & Fitness',
    short: 'Fitness',
    color: '#10b981',
    skills: ['Speed', 'Coordination', 'Explosive Strength', 'Reflex', 'Flexibility'],
  },
  {
    id: 'personality',
    label: 'Games Playing Personality',
    short: 'Mental',
    color: '#f59e0b',
    skills: [
      'Concentration', 'Communication', 'Leadership', 'Discipline',
      'Attitude', 'Creativity', 'Courage', 'Relationship', 'Confidence',
    ],
  },
]

export const FOOTBALL_POSITIONS = [
  { id: 'GK', label: 'Goalkeeper',    group: 'Goalkeeper' },
  { id: 'RB', label: 'Right Back',    group: 'Defender'   },
  { id: 'CB', label: 'Center Back',   group: 'Defender'   },
  { id: 'LB', label: 'Left Back',     group: 'Defender'   },
  { id: 'DM', label: 'Defensive Mid', group: 'Midfielder' },
  { id: 'CM', label: 'Central Mid',   group: 'Midfielder' },
  { id: 'AM', label: 'Attacking Mid', group: 'Midfielder' },
  { id: 'RW', label: 'Right Wing',    group: 'Forward'    },
  { id: 'LW', label: 'Left Wing',     group: 'Forward'    },
  { id: 'ST', label: 'Striker',       group: 'Forward'    },
  { id: 'CF', label: 'Center Forward',group: 'Forward'    },
]

export const POSITION_COLORS = {
  GK: { bg: 'bg-yellow-100',  text: 'text-yellow-700',  hex: '#d97706' },
  RB: { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  CB: { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  LB: { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  DM: { bg: 'bg-green-100',   text: 'text-green-700',   hex: '#059669' },
  CM: { bg: 'bg-green-100',   text: 'text-green-700',   hex: '#059669' },
  AM: { bg: 'bg-teal-100',    text: 'text-teal-700',    hex: '#0d9488' },
  RW: { bg: 'bg-red-100',     text: 'text-red-700',     hex: '#dc2626' },
  LW: { bg: 'bg-red-100',     text: 'text-red-700',     hex: '#dc2626' },
  ST: { bg: 'bg-purple-100',  text: 'text-purple-700',  hex: '#7c3aed' },
  CF: { bg: 'bg-purple-100',  text: 'text-purple-700',  hex: '#7c3aed' },
}

export const SPORT_CATEGORIES = {
  Football: FOOTBALL_CATEGORIES,
  Tennis: null,
  Squash: null,
  'Table Tennis': null,
}

export function getCategoryAvg(scores, skills) {
  const vals = skills.map(s => Number(scores?.[s] || 0)).filter(v => v > 0)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
}

export function getOverallScore(scores, categories) {
  const avgs = categories.map(cat => getCategoryAvg(scores, cat.skills)).filter(v => v > 0)
  return avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : 0
}

export function getTier(score) {
  if (score >= 80) return { label: 'Elite',  textClass: 'text-purple-700', bgClass: 'bg-purple-100',  borderClass: 'border-purple-300',  hex: '#7c3aed' }
  if (score >= 60) return { label: 'Gold',   textClass: 'text-yellow-700', bgClass: 'bg-yellow-100',  borderClass: 'border-yellow-300',  hex: '#d97706' }
  if (score >= 40) return { label: 'Silver', textClass: 'text-slate-500',  bgClass: 'bg-slate-100',   borderClass: 'border-slate-300',   hex: '#64748b' }
  return               { label: 'Bronze', textClass: 'text-orange-700', bgClass: 'bg-orange-100',  borderClass: 'border-orange-300',  hex: '#c2410c' }
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

export function monthLabel(yyyyMM) {
  if (!yyyyMM) return ''
  const [y, m] = yyyyMM.split('-')
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export const SKILL_SHORTS = {
  'Controlling':            'Control',
  'Handling Air Ball':      'Air Ball',
  'Handling Low Ball':      'Low Ball',
  'Passing':                'Passing',
  'Reaction':               'Reaction',
  'Shooting':               'Shooting',
  'Heading':                'Heading',
  'Distribution (GK)':      'GK Dist.',
  'Attacking Tactics':      'Attack',
  'Defending Tactics':      'Defend',
  'Game Intelligence':      'Game IQ',
  'Anticipation':           'Anticip.',
  'Roles & Responsibility': 'Roles',
  'Positioning':            'Position',
  'Speed':                  'Speed',
  'Coordination':           'Coord.',
  'Explosive Strength':     'Strength',
  'Reflex':                 'Reflex',
  'Flexibility':            'Flex.',
  'Concentration':          'Focus',
  'Communication':          'Comm.',
  'Leadership':             'Leader',
  'Discipline':             'Discip.',
  'Attitude':               'Attitude',
  'Creativity':             'Creative',
  'Courage':                'Courage',
  'Relationship':           'Relation.',
  'Confidence':             'Confid.',
}

export function buildMonthOpts(count = 12) {
  const opts = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ value, label: monthLabel(value) })
  }
  return opts
}

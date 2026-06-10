import { toLocalMonthStr } from './dates'

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

// 4-3-3 formation — 11 positions with pitch coordinates (x: left→right, y: bottom→top, 0–100)
export const FOOTBALL_POSITIONS = [
  { id: 'GK',   label: 'Goalkeeper',                   group: 'Goalkeeper', x: 50, y: 7  },
  { id: 'RB',   label: 'Right Back',                   group: 'Defender',   x: 83, y: 23 },
  { id: 'RCB',  label: 'Right Center Back',             group: 'Defender',   x: 62, y: 20 },
  { id: 'LCB',  label: 'Left Center Back',              group: 'Defender',   x: 38, y: 20 },
  { id: 'LB',   label: 'Left Back',                    group: 'Defender',   x: 17, y: 23 },
  { id: 'CDM',  label: 'Central Defensive Midfielder',  group: 'Midfielder', x: 50, y: 38 },
  { id: 'LCAM', label: 'Central Attacking Midfielder',  group: 'Midfielder', x: 28, y: 53 },
  { id: 'RCAM', label: 'Central Attacking Midfielder',  group: 'Midfielder', x: 72, y: 53 },
  { id: 'LW',   label: 'Left Winger',                  group: 'Forward',    x: 15, y: 73 },
  { id: 'ST',   label: 'Striker',                      group: 'Forward',    x: 50, y: 80 },
  { id: 'RW',   label: 'Right Winger',                 group: 'Forward',    x: 85, y: 73 },
]

export const POSITION_COLORS = {
  GK:   { bg: 'bg-yellow-100',  text: 'text-yellow-700',  hex: '#d97706' },
  RB:   { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  RCB:  { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  LCB:  { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  LB:   { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563eb' },
  CDM:  { bg: 'bg-green-100',   text: 'text-green-700',   hex: '#059669' },
  LCAM: { bg: 'bg-teal-100',    text: 'text-teal-700',    hex: '#0d9488' },
  RCAM: { bg: 'bg-teal-100',    text: 'text-teal-700',    hex: '#0d9488' },
  LW:   { bg: 'bg-red-100',     text: 'text-red-700',     hex: '#dc2626' },
  ST:   { bg: 'bg-purple-100',  text: 'text-purple-700',  hex: '#7c3aed' },
  RW:   { bg: 'bg-red-100',     text: 'text-red-700',     hex: '#dc2626' },
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
  return toLocalMonthStr()
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

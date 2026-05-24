// Dev-only data generators — Vite tree-shakes this file entirely in production
// because every consumer is wrapped in `import.meta.env.DEV` checks.

const FIRST = ['Arjun','Priya','Rahul','Meera','Vikram','Ananya','Rohit','Sneha',
  'Kabir','Divya','Aakash','Pooja','Siddharth','Neha','Ayaan','Riya','Shivam',
  'Ishaan','Tanvi','Karthik','Manav','Simran','Varun','Kriti','Nikhil']
const LAST  = ['Sharma','Patel','Mehta','Singh','Verma','Gupta','Joshi','Reddy',
  'Nair','Agarwal','Rao','Kumar','Shah','Kapoor','Mishra','Pandey','Iyer','Bose']
const ROLES = ['Head Coach','Assistant Coach','Fitness Trainer','Team Manager',
  'Physio','Analyst','Ground Staff','Scout']
const DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MODES = ['UPI','Cash','Bank Transfer','Cheque']
const GROUNDS = ['Ground A','Ground B','Main Field','Indoor Court','Net Area',
  'Practice Pitch','Astro Turf','Multipurpose Court']
const BATCH_SLOTS = [
  ['06:00','08:00'],['07:00','09:00'],['16:00','18:00'],
  ['17:00','19:00'],['18:00','20:00'],['05:30','07:30'],
]

const pick  = arr => arr[Math.floor(Math.random() * arr.length)]
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const pad   = n => String(n).padStart(2, '0')

export const fakePhone = () => {
  const prefix = pick(['6','7','8','9'])
  return prefix + String(rand(100000000, 999999999))
}

export const fakeName = () => `${pick(FIRST)} ${pick(LAST)}`

const today = () => new Date()

const isoDate = d =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const addMonths = (dateStr, n) => {
  const [yr, mo] = dateStr.split('-').map(Number)
  return new Date(yr, mo - 1 + n, 0).toISOString().split('T')[0]
}

const randomDob = (minAge, maxAge) => {
  const d = today()
  d.setFullYear(d.getFullYear() - rand(minAge, maxAge))
  d.setMonth(rand(0, 11))
  d.setDate(rand(1, 28))
  return isoDate(d)
}

// ── Student ───────────────────────────────────────────────────
export function fillStudent({ sportOptions = [], batches = [] } = {}) {
  const sport    = sportOptions.length ? pick(sportOptions) : 'Cricket'
  const matched  = batches.filter(b => !b.sports?.length || b.sports.includes(sport))
  const batch    = (matched.length ? pick(matched) : batches[0]) || null
  const joinDate = isoDate(today())
  return {
    name:          fakeName(),
    parent:        fakeName(),
    phone:         fakePhone(),
    parentPhone:   fakePhone(),
    dob:           randomDob(8, 18),
    sport,
    joinDate,
    paidTill:      addMonths(joinDate, 1),
    batchId:       batch ? Number(batch.id) : '',
    batchName:     batch?.name || '',
    trainingType:  'Daily',
    fees:          String(pick([800, 1000, 1200, 1500, 2000])),
    feePlan:       'monthly',
    joiningFee:    '',
  }
}

// ── Batch ─────────────────────────────────────────────────────
export function fillBatch({ sportOptions = [] } = {}) {
  const sport      = sportOptions.length ? pick(sportOptions) : 'Cricket'
  const [start, end] = pick(BATCH_SLOTS)
  const ageMin     = rand(6, 14)
  const suffix     = pick(['Morning','Evening','Weekend','Elite','Foundation'])
  const days       = [...new Set([pick(DAYS), pick(DAYS), pick(DAYS)])].slice(0, rand(2, 3))
  return {
    name:        `${sport} U${ageMin + rand(2, 4)} ${suffix}`,
    code:        '',
    startTime:   start,
    endTime:     end,
    sports:      [sport],
    coach:       fakeName(),
    capacity:    pick([15, 20, 25, 30]),
    days,
    ageMin,
    ageMax:      ageMin + rand(4, 8),
    ground:      pick(GROUNDS),
    defaultFee:  pick([800, 1000, 1200, 1500, 2000]),
    defaultPlan: 'monthly',
  }
}

// ── Trial ─────────────────────────────────────────────────────
const AGE_GROUPS = ['U8','U10','U12','U14','U16','U18','U21','Open']

export function fillTrial({ sports = [], batches = [] } = {}) {
  const sport    = sports.length ? pick(sports) : 'Cricket'
  const matched  = batches.filter(b => (b.sports || []).includes(sport))
  const batch    = matched.length ? pick(matched) : null
  const ageGroup = pick(AGE_GROUPS)
  const age      = rand(8, 20)
  return {
    name:         fakeName(),
    parent:       fakeName(),
    phone:        fakePhone(),
    age:          String(age),
    dob:          randomDob(age, age),
    ageGroup,
    sport,
    programType:  'academy',
    trialDate:    isoDate(today()),
    trialSessions: pick([1, 2, 3]),
    trialFeePaid: 590,
    quotedFee:    String(pick([800, 1000, 1200, 1500])),
    batchId:      batch ? String(batch.id) : '',
    notes:        '',
    sessionStart: '',
    sessionEnd:   '',
  }
}

// ── Payment ───────────────────────────────────────────────────
// Returns a student to select + payment overrides (student must be picked by caller).
export function fillPayment({ students = [] } = {}) {
  const student = students.length ? pick(students) : null
  return {
    student,
    mode:         pick(MODES),
    paymentType:  'monthly',
    discountPct:  pick([0, 0, 0, 5, 10]),
    notes:        '',
  }
}

// ── Staff ─────────────────────────────────────────────────────
export function fillStaff({ sportOptions = [] } = {}) {
  const sport = sportOptions.length ? pick(sportOptions) : 'Cricket'
  return {
    name:      fakeName(),
    role:      pick(ROLES),
    phone:     fakePhone(),
    age:       String(rand(22, 45)),
    sports:    [sport],
    status:    'Active',
    staffType: 'coach',
  }
}

// ── Event / Tournament ────────────────────────────────────────
const EVENT_TITLES = [
  'Annual Sports Day','Regional Championship','Junior League','Summer Camp',
  'Open Trials','Friendly Match','Inter-Academy Cup','Skill Showcase',
  'Parents vs Coaches','Year-End Tournament',
]
const VENUES = ['Main Ground','Community Stadium','Sports Complex','Indoor Arena',
  'City Sports Park','Academy Field','Practice Pitch','Multipurpose Court']

export function fillEvent({ sportOptions = [] } = {}) {
  const sport = sportOptions.length ? pick(sportOptions) : 'Cricket'
  const d = today()
  d.setDate(d.getDate() + rand(7, 60))
  const start = isoDate(d)
  d.setDate(d.getDate() + rand(0, 2))
  const end = isoDate(d)
  return {
    title:        pick(EVENT_TITLES),
    type:         pick(['event', 'event', 'tournament']),
    sport,
    date:         start,
    endDate:      end,
    venue:        pick(VENUES),
    description:  `Open to all ${sport.toLowerCase()} students. Registration on the day. Snacks and water provided.`,
    audienceType: 'all',
    audienceIds:  [],
    bracketType:  'knockout',
    flyerFile:    null,
  }
}

// ── Announcement ──────────────────────────────────────────────
const ANNOUNCE = [
  { type: 'Holiday',     title: 'Academy Closed Tomorrow',
    body: 'The academy will remain closed tomorrow for the local festival. Regular classes resume the day after.' },
  { type: 'Tournament',  title: 'Inter-Branch Cup Next Week',
    body: 'Sign up at the front desk by Friday. Open to all U14+ students. Selection trials on Saturday morning.' },
  { type: 'Achievement', title: 'Congratulations to Our State Team!',
    body: 'Our students brought home 3 medals at the state championships last weekend. Well done team!' },
  { type: 'Reminder',    title: 'Monthly Fees Due',
    body: 'A friendly reminder that monthly fees are due by the 5th. Please pay at the front desk or via UPI.' },
  { type: 'Announcement',title: 'New Coaching Staff',
    body: 'We are happy to welcome two new coaches joining the academy from next week. Come say hello!' },
]
export function fillAnnouncement() {
  return pick(ANNOUNCE)
}

// ── Drill ─────────────────────────────────────────────────────
const DRILL_NAMES = ['Rondo 4v1','Two-Touch Passing','Cone Dribbling','Shooting Pyramid',
  'Box-to-Box Fitness','Crossing & Finishing','1v1 Defending','Quick Feet Ladder',
  'Possession Squares','Wall Pass Drill','Through-Ball Trigger','Counter-Attack 3v2']
const DRILL_CATEGORIES = ['warm_up','technical','passing','shooting','defending','ssg','match','cool_down']
const EQUIPMENT_OPTS  = ['Cones','Balls','Bibs','Goals','Markers','Ladder','Mannequins','Stopwatch']

export function fillDrill() {
  const cat = pick(DRILL_CATEGORIES)
  const minP = rand(4, 8)
  return {
    name:            pick(DRILL_NAMES),
    category:        cat,
    age_group:       pick(['U10','U12','U14','U16','All']),
    duration:        pick([10, 15, 20, 25, 30]),
    min_players:     minP,
    max_players:     minP + rand(4, 10),
    difficulty:      pick(['beginner', 'intermediate', 'advanced']),
    equipment:       Array.from(new Set([pick(EQUIPMENT_OPTS), pick(EQUIPMENT_OPTS), pick(EQUIPMENT_OPTS)])),
    tags:            [],
    area:            pick(['20x20m','30x20m','Half Pitch','Full Pitch','Penalty Box']),
    context_ct:      'Attacking transition after losing possession in the middle third.',
    context_mt:      'Practice quick recovery and triggers to win the ball back high up the pitch.',
    procedure: [
      'Set up the grid with cones and place players in designated positions.',
      'Coach signals start; one team begins with possession.',
      'Rotate roles every 2 minutes to keep intensity high.',
    ],
    coaching_points: [
      'Body shape when receiving — open up to play forward.',
      'Communication — call for the ball loudly.',
      'First touch out of feet, away from pressure.',
    ],
    progressions: ['Add a second defender', 'Reduce touches to 2 max'],
    regressions:  ['Increase grid size', 'Allow unlimited touches'],
    objectives:   ['Improve first touch', 'Sharpen short passing under pressure'],
    diagram_preset: pick(['full_pitch','half_pitch','channel','small_grid']),
    diagram_url:    '',
  }
}

// ── Staff Invite ──────────────────────────────────────────────
export function fillInvite() {
  return {
    name:       fakeName(),
    accessRole: pick(['coach', 'coach', 'admin']),
  }
}

// ── Skill Assessment ──────────────────────────────────────────
// `categories` shape: [{ id, skills: ['skill1', ...] }]
export function fillAssessment({ categories = [] } = {}) {
  const scores = {}
  categories.forEach(cat => {
    (cat.skills || []).forEach(sk => {
      // Bias around 55-80 so the result looks plausible (not random across full 0-100)
      scores[sk] = rand(55, 85)
    })
  })
  return {
    scores,
    notes:    'Solid effort this month. Continues to improve under pressure. Focus on left-foot accuracy and movement off the ball next cycle.',
    position: pick(['Striker','Midfielder','Defender','Goalkeeper','Winger']),
  }
}

// ── Signup (Owner) ────────────────────────────────────────────
const ACADEMY_NAMES = ['Champions Sports Academy','Elite Football Club','Star Athletes Academy',
  'Pro Sports Hub','Victory Sports Training','Galaxy Sports Academy']
export function fillSignupOwner() {
  const ownerName   = fakeName()
  const academyName = pick(ACADEMY_NAMES)
  const slug        = ownerName.toLowerCase().replace(/\s+/g, '.')
  return {
    ownerName,
    academyName,
    ownerEmail: `${slug}+${Date.now().toString().slice(-5)}@test.local`,
    ownerPw:    'demo1234',
  }
}

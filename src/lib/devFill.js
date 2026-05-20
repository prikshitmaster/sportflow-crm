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

// Canonical sport catalog — mirrors the backfill list in
// supabase/migrations/0016b_sport_catalog.sql.
// Sport selection across the app should come from this list only.
export const SPORT_CATALOG = [
  'Football',
  'Cricket',
  'Tennis',
  'Squash',
  'Table Tennis',
  'Basketball',
  'Badminton',
  'Swimming',
  'Volleyball',
  'Hockey',
]

// The sports this academy actually runs, as canonical catalog names.
// Combines both sources: the legacy academy_branches text array (`branches`)
// and the newer sport_branches rows — cricket used to go missing from pickers
// because it only existed in the latter. Falls back to the whole catalog when
// nothing is configured yet. Mirrors the resolution already done inline in
// Students.jsx's AddStudentModal.
export function academySportOptions({ branches, sportBranches } = {}) {
  const catalogLower = SPORT_CATALOG.map(s => s.toLowerCase())
  const names = [...new Set([
    ...(branches || []).map(b => String(b)),
    ...(sportBranches || []).map(b => b.sportName).filter(Boolean),
  ])]
  const configured = names
    .filter(n => catalogLower.includes(n.toLowerCase()))
    .map(n => SPORT_CATALOG[catalogLower.indexOf(n.toLowerCase())])
  return configured.length > 0 ? configured : SPORT_CATALOG
}

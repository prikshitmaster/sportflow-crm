// Shared vocabulary for the two forms that register a student — the public
// /join funnel (TrialEnroll.jsx) and the owner's Add Student modal
// (Students.jsx). They ask the same questions, so they must offer the same
// answers; this file exists so they can't drift apart again.
//
// Lives in lib/ rather than in either page because Students.jsx importing a
// constant out of TrialEnroll.jsx would drag that whole lazily-loaded page
// into the owner bundle.

// Who the student is to the person filling the form. 'Myself' covers an adult
// registering themselves — the funnel is not parents-only — and 'Sibling'
// covers an older brother or sister doing the paperwork. 'Other' opens a
// free-text box, so the stored value is not limited to this list.
//
// ASKED ON /join ONLY. The owner's Add Student modal deliberately doesn't ask:
// the office is sitting with the family and already records the parent's name
// directly, so the question has no answer there worth typing. students.relationship
// therefore stays blank for walk-ins and is only populated via conversion.
export const RELATIONSHIP_OPTIONS = ['Myself', 'Sibling', 'Daughter', 'Son', 'Other']

// The health question is a required yes/no. Because it's required, a blank
// medical note on a row created through either form means "answered No", not
// "never asked" — that's why there's no separate boolean column for it.
export const MEDICAL_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no',  label: 'No'  },
]

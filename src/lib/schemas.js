// Zod schemas — single source of truth for input validation.
//
// Status: ADDITIVE. The existing imperative validators in forms still run.
// New code should prefer these; old code can adopt incrementally.
//
// Why a schema layer:
//   Phone validation today is `/^\d{10}$/` in Students.jsx, repeated in two
//   onChange handlers, missing entirely from Staff/Trials. Email is unchecked
//   anywhere. Amounts use `Number(x) <= 0` with no upper bound. The same field
//   must mean the same thing in every form AND every API payload — that is
//   what schemas give us.
//
// Usage:
//   const result = studentSchema.safeParse(form)
//   if (!result.success) {
//     const fieldErrors = result.error.flatten().fieldErrors
//     // { name: ['Required'], phone: ['Enter a 10-digit number'], ... }
//   }

import { z } from 'zod'

// ── Reusable atoms ─────────────────────────────────────────────────

export const phone10 = z.string()
  .regex(/^\d{10}$/, 'Enter a 10-digit number')

export const phoneOptional = z.union([z.literal(''), phone10]).optional()

export const email = z.string()
  .email('Enter a valid email address')

export const emailOptional = z.union([z.literal(''), email]).optional()

export const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

export const isoDateOptional = z.union([z.literal(''), isoDate]).optional()

export const positiveAmount = z.coerce.number()
  .positive('Amount must be greater than 0')
  .max(10_000_000, 'Amount seems too large — please double-check')

export const nonNegativeAmount = z.coerce.number()
  .min(0, 'Amount cannot be negative')
  .max(10_000_000, 'Amount seems too large — please double-check')

// Names: trimmed, 2..80 chars, allow letters/spaces/dots/apostrophes/hyphens
export const personName = z.string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name is too long')

// Codes (student/staff/join) — letters+digits, exact length where known
export const joinCode6 = z.string()
  .regex(/^[A-Z0-9]{6}$/i, 'Join code must be 6 letters/digits')

// ── Domain schemas ─────────────────────────────────────────────────

// Student form (Add / Edit) — covers the fields actually validated today in
// Students.jsx + EditStudentModal. Optional fields stay optional so existing
// flows that omit them still pass.
export const studentSchema = z.object({
  name:        personName,
  phone:       phoneOptional,         // parent contact — optional today
  parent:      z.string().trim().max(80).optional().or(z.literal('')),
  sport:       z.string().trim().min(1, 'Select a sport'),
  batchId:     z.union([z.string().min(1, 'Select a batch'), z.number()]),
  fees:        nonNegativeAmount,
  joinDate:    isoDateOptional,
  paidTill:    z.string().optional(), // can be YYYY-MM or YYYY-MM-DD; legacy
  feePlan:     z.enum(['monthly', 'quarterly', 'halfyearly', 'yearly', 'custom']).optional(),
  trainingType:z.enum(['Daily', 'Weekly']).optional(),
})

// Staff form
export const staffSchema = z.object({
  name:       personName,
  phone:      phoneOptional,
  email:      emailOptional,
  staffType:  z.string().trim().min(1, 'Select a staff type'),
  accessRole: z.enum(['owner','admin','coach','receptionist','accountant','staff']).optional(),
})

// Payment form
export const paymentSchema = z.object({
  studentId: z.union([z.string().min(1, 'Select a student'), z.number()]),
  amount:    positiveAmount,
  date:      isoDate,
  status:    z.enum(['Paid', 'Pending', 'Overdue']).default('Paid'),
  mode:      z.enum(['Cash','UPI','Bank','Card','Other']).optional(),
  month:     z.string().optional(),
})

// Trial lead
export const trialSchema = z.object({
  name:    personName,
  phone:   phone10,
  sport:   z.string().trim().min(1, 'Select a sport'),
  source:  z.string().trim().optional(),
  date:    isoDateOptional,
})

// Batch
export const batchSchema = z.object({
  name:    z.string().trim().min(1, 'Name is required').max(50),
  sport:   z.string().trim().min(1, 'Select a sport'),
  time:    z.string().trim().optional(),
  days:    z.array(z.string()).optional(),
  coachId: z.union([z.string(), z.number()]).optional(),
})

// ── Helper: flatten Zod error into the {field: msg} shape forms already use ──
export function fieldErrors(zodError) {
  if (!zodError) return {}
  const flat = zodError.flatten().fieldErrors
  const out = {}
  for (const [k, v] of Object.entries(flat)) {
    if (Array.isArray(v) && v.length) out[k] = v[0]
  }
  return out
}

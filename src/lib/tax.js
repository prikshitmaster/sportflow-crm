// Per-branch tax — the single source of truth for "does this cost tax, and
// how much", the way dates.js owns IST dates and studentRules.js owns overdue.
//
// Tax is configured per BRANCH, per FEE TYPE, at the branch's own rate
// (migration 0154): a branch can tax the trial fee but not the kit fee, or
// monthly fees but neither. Nothing is taxed until an owner opts in.
//
// THE INVARIANT, repeated here because it is easy to get backwards:
//   the stored `amount` is always the GROSS figure the payer hands over, and
//   `taxAmount` is the portion OF that which is tax. base = amount - taxAmount.
//   Tax is quoted EXCLUSIVE — computeTax() adds it on top of a base to reach
//   the total — but once written to the database it is a breakdown of the
//   total, never an extra row on top of it.

// Rupees, not paise. Razorpay bills in integer paise and reconciliation drifts
// if the displayed total and the charged total round differently, so every
// amount in this app is a whole rupee and rounding happens exactly once, here.
const round = (n) => Math.round(Number(n) || 0)

/**
 * Which rate applies to one bucket of a branch's fees.
 * Returns 0 unless the branch has a real rate AND has switched that bucket on,
 * so callers never have to remember the toggle/rate interaction.
 *
 * @param branch  a branch row, camelCase (app state) or snake_case (raw server
 *                row) — both are accepted because /join reads the RPC payload
 *                directly while the owner app maps it through db.js first.
 * @param bucket  'fees' | 'trial' | 'kit'
 */
export function resolveBranchTax(branch, bucket) {
  if (!branch) return 0
  const pct = Number(branch.taxPercent ?? branch.tax_percent ?? 0)
  if (!(pct > 0)) return 0
  const on = {
    fees:  branch.taxOnFees  ?? branch.tax_on_fees,
    trial: branch.taxOnTrial ?? branch.tax_on_trial,
    kit:   branch.taxOnKit   ?? branch.tax_on_kit,
  }[bucket]
  return on ? pct : 0
}

/**
 * Add `pct` tax on top of `base`.
 * @returns { base, taxPct, taxAmount, total } — all whole rupees.
 */
export function computeTax(base, pct) {
  const b = round(base)
  const p = Number(pct) || 0
  if (!(p > 0) || b <= 0) return { base: b, taxPct: 0, taxAmount: 0, total: b }
  const taxAmount = round((b * p) / 100)
  return { base: b, taxPct: p, taxAmount, total: b + taxAmount }
}

/**
 * The /join case: trial fee and kit fee can be taxed independently, so the tax
 * is charged on the taxable subtotal only. Returns everything the fee section
 * and the receipt need, including which items were actually taxed — a parent
 * must be able to see that "GST @ 18%" was charged on the trial fee alone and
 * not on the whole subtotal.
 *
 * @returns { trialFee, kitFee, subtotal, taxableBase, taxPct, taxAmount, total, taxedLabel }
 *          taxedLabel is null when nothing is taxed.
 */
export function computeTrialTotal(branch, trialFee, kitFee = 0) {
  const trial = round(trialFee)
  const kit   = round(kitFee)
  const trialPct = resolveBranchTax(branch, 'trial')
  const kitPct   = resolveBranchTax(branch, 'kit')

  // One rate per branch, so the two buckets can only ever differ in whether
  // they are taxed at all — never in rate. That keeps this a single GST row
  // instead of one row per item.
  const taxPct = trialPct || kitPct
  const taxableBase = (trialPct ? trial : 0) + (kitPct ? kit : 0)
  const { taxAmount } = computeTax(taxableBase, taxPct)

  const taxedNames = [trialPct && trial > 0 ? 'trial fee' : null,
                      kitPct   && kit   > 0 ? 'kit fee'   : null].filter(Boolean)
  // Only name the base when it is narrower than everything charged — saying
  // "on trial fee + kit fee" when those are the only two items is noise.
  const bothCharged = trial > 0 && kit > 0
  const taxedLabel  = taxAmount > 0 && bothCharged && taxedNames.length === 1
    ? `on ${taxedNames[0]}`
    : null

  return {
    trialFee: trial,
    kitFee:   kit,
    subtotal: trial + kit,
    taxableBase,
    taxPct:   taxAmount > 0 ? taxPct : 0,
    taxAmount,
    total:    trial + kit + taxAmount,
    taxedLabel,
  }
}

/** "GST @ 18%" / "GST @ 18% (on trial fee)" — one label, used by form and receipt. */
export function taxRowLabel(taxPct, taxedLabel = null) {
  const pct = Number(taxPct) || 0
  if (!(pct > 0)) return ''
  // Trailing .00 reads as false precision on a receipt; 18.5% must survive.
  const shown = Number.isInteger(pct) ? String(pct) : String(pct).replace(/0+$/, '').replace(/\.$/, '')
  return `GST @ ${shown}%${taxedLabel ? ` (${taxedLabel})` : ''}`
}

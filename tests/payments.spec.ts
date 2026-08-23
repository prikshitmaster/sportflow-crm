// Real browser, real login, real click-through of the "Record Payment" flow
// against a disposable QA academy (see global-setup.ts) — then a direct DB
// read to confirm the row actually landed, since a silent UI/DB mapping bug
// (the recurring snake_case/camelCase class documented in CLAUDE.md) can
// leave the modal looking successful while nothing persisted.
import { test, expect } from '@playwright/test'
import { readState, pgQuery } from './support/db'

test('owner can record a payment for a student and it persists', async ({ page }) => {
  const state = readState()
  const student = state.students.find(s => s.name === 'QA Student Payments')!

  await page.goto('/login')
  await page.locator('input[type="email"]').fill(state.ownerEmail)
  await page.locator('input[type="password"]').fill(state.ownerPassword)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL('**/dashboard')

  // Fresh owner session has no sport/branch scoped yet — the owner shell is a
  // two-level picker: a location ("QA B1") drills into the sports it runs,
  // then picking a sport ("Cricket") is what actually sets selectedSport +
  // selectedBranch (see SportSelect.jsx pickSportAtLocation) and persists
  // them to localStorage. Only after that does /payments stay on /payments
  // instead of bouncing back to this picker on the next full navigation.
  await page.getByRole('button', { name: /QA B1/ }).click()
  await page.getByRole('button', { name: /Cricket/ }).click()
  await page.waitForURL('**/dashboard')

  await page.goto('/payments')
  await page.getByRole('button', { name: 'Record Payment' }).click()

  const modal = page.getByRole('heading', { name: 'Record Payment' })
  await expect(modal).toBeVisible()

  await page.getByPlaceholder('Type to search student…').fill(student.name)
  await page.getByRole('button', { name: new RegExp(student.name) }).click()

  const confirmBtn = page.getByRole('button', { name: /^Confirm ·/ })
  await expect(confirmBtn).toBeEnabled({ timeout: 10_000 })
  await confirmBtn.click()

  await expect(modal).toBeHidden({ timeout: 10_000 })

  const row = await pgQuery(
    `select amount, mode, student_id from payments where student_id = $1 order by created_at desc limit 1`,
    [student.id]
  )
  expect(row.rowCount).toBe(1)
  expect(Number(row.rows[0].amount)).toBe(1200)
  expect(String(row.rows[0].student_id)).toBe(String(student.id)) // bigint comes back as a string from pg
})

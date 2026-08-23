// Real browser, real coach login, real tap-to-mark-attendance flow against a
// disposable QA academy (see global-setup.ts) — then a direct DB read to
// confirm the mark actually persisted, not just that the UI looked happy.
import { test, expect } from '@playwright/test'
import { readState, pgQuery } from './support/db'

test('coach can mark a student present and it persists', async ({ page }) => {
  const state = readState()
  const student = state.students.find(s => s.name === 'QA Student Attendance')!

  await page.goto('/staff-login')
  await page.locator('input[type="email"]').fill(state.coach.email)
  await page.locator('input[type="password"]').fill(state.coach.password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL('**/staff/**')

  await page.goto('/staff/attendance')
  await page.getByRole('button', { name: new RegExp(state.batchName) }).click()

  // Tap once: blank -> Present
  await page.getByRole('button', { name: new RegExp(student.name) }).click()

  await page.getByRole('button', { name: /^Save/ }).click()
  await expect(page.getByText('Attendance Saved!')).toBeVisible({ timeout: 10_000 })

  const row = await pgQuery(
    `select status, student_id from attendance where student_id = $1 order by date desc, id desc limit 1`,
    [student.id]
  )
  expect(row.rowCount).toBe(1)
  expect(row.rows[0].status).toBe('Present')
})

import { test, expect } from '@playwright/test'
import { loginAsOwner, fillAddStudentForm } from './helpers.js'

test.describe('Add Student', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/students')
  })

  // ── Validation ─────────────────────────────────────────────────────────────

  test('blocks submit when name is empty', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    // Leave name blank, fill phone and training type
    await page.fill('input[placeholder="10-digit number"]', '9999999999')
    await page.click('button:has-text("Daily")')
    await page.click('button:has-text("Add Student & Generate Code")')
    await expect(page.locator('text=Required')).toBeVisible()
  })

  test('blocks submit when training type not selected', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    await page.fill('input[placeholder="Full name"]', 'Test Block')
    await page.fill('input[placeholder="10-digit number"]', '9999999999')
    // Intentionally skip training type
    await page.click('button:has-text("Add Student & Generate Code")')
    await expect(page.locator('text=Select a training type')).toBeVisible()
  })

  test('blocks submit when phone is invalid', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    await page.fill('input[placeholder="Full name"]', 'Test Phone')
    await page.fill('input[placeholder="10-digit number"]', '123')  // too short
    await page.click('button:has-text("Daily")')
    await page.click('button:has-text("Add Student & Generate Code")')
    await expect(page.locator('text=Enter 10-digit number')).toBeVisible()
  })

  // ── Happy path ─────────────────────────────────────────────────────────────

  test.skip('adds student successfully — Daily, no fee', async ({ page }) => {
    const name = `PW Daily ${Date.now()}`
    await fillAddStudentForm(page, { name, phone: '9000000001', trainingType: 'Daily' })

    // Select a batch (pick first available)
    await page.selectOption('select', { index: 1 })

    await page.click('button:has-text("Add Student & Generate Code")')

    // Modal should close and student should appear in list
    await expect(page.locator('text=Add New Student')).not.toBeVisible({ timeout: 8000 })
    await expect(page.locator(`text=${name}`)).toBeVisible()
  })

  test.skip('adds student with fee + paidTill — creates payment record', async ({ page }) => {
    const name = `PW Paid ${Date.now()}`
    await fillAddStudentForm(page, {
      name,
      phone:        '9000000002',
      trainingType: 'Alternate',
      fees:         9000,
      paidTill:     '2026-05-31',
    })

    await page.selectOption('select', { index: 1 })
    await page.click('button:has-text("Add Student & Generate Code")')
    await expect(page.locator('text=Add New Student')).not.toBeVisible({ timeout: 8000 })

    // Go to Payments and verify a row was created for this student
    await page.goto('/payments')
    await page.fill('input[placeholder="Search by student or invoice..."]', name)
    await expect(page.locator(`text=${name}`)).toBeVisible({ timeout: 5000 })
  })

  test('fee hint shows when fee filled but no paidTill', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    await page.fill('input[placeholder="e.g. 9000"]', '9000')
    await expect(page.locator('text=Set Paid Till below to auto-record first payment')).toBeVisible()
  })

  test('paidTill warning shows when paidTill filled but no fee', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    const dateInputs = page.locator('input[type="date"]')
    await dateInputs.nth(1).fill('2026-05-31')
    await expect(page.locator('text=Set Monthly Fee above to auto-record the payment')).toBeVisible()
  })

  // ── Duplicate phone guard ───────────────────────────────────────────────────

  test('cancels without adding when Cancel clicked', async ({ page }) => {
    await page.click('button:has-text("Add Student")')
    await page.waitForSelector('text=Add New Student')
    await page.fill('input[placeholder="Full name"]', 'Should Not Exist')
    await page.click('button:has-text("Cancel")')
    await expect(page.locator('text=Add New Student')).not.toBeVisible()
    await expect(page.locator('text=Should Not Exist')).not.toBeVisible()
  })

})

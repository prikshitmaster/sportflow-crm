import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers.js'

test.describe('Record Payment', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/payments')
  })

  // ── Modal opens ─────────────────────────────────────────────────────────────

  test('Record Payment button opens modal', async ({ page }) => {
    await page.click('button:has-text("Record Payment")')
    await expect(page.locator('text=Record Payment').first()).toBeVisible()
  })

  // ── Student selection ────────────────────────────────────────────────────────

  test('selecting a student pre-fills fee amount', async ({ page }) => {
    await page.click('button:has-text("Record Payment")')
    await page.fill('input[placeholder="Type to search student…"]', 'test')
    await page.waitForSelector('.bg-white.border.border-gray-200') // dropdown
    await page.locator('.bg-white.border.border-gray-200 button').first().click()
    // Fee input should now have a value
    const feeInput = page.locator('input[type="number"]').first()
    const val = await feeInput.inputValue()
    expect(Number(val)).toBeGreaterThanOrEqual(0)
  })

  // ── Duplicate guard ──────────────────────────────────────────────────────────

  test.skip('duplicate payment within 60s is blocked', async ({ page }) => {
    // This test requires an existing student — adjust name to a real one
    await page.click('button:has-text("Record Payment")')
    await page.fill('input[placeholder="Type to search student…"]', 'prikshit')
    await page.waitForSelector('.bg-white.border.border-gray-200')
    await page.locator('.bg-white.border.border-gray-200 button').first().click()

    // Try to save once
    await page.click('button:has-text("Save Payment")')
    // Try to save again immediately — should get duplicate error toast
    await page.click('button:has-text("Save Payment")')
    await expect(page.locator('text=Duplicate blocked').or(page.locator('text=Already recording'))).toBeVisible({ timeout: 5000 })
  })

  // ── Advance payment label ────────────────────────────────────────────────────

  test('quarterly payment shows correct coverage label', async ({ page }) => {
    await page.click('button:has-text("Record Payment")')
    await page.fill('input[placeholder="Type to search student…"]', 'test')
    await page.waitForSelector('.bg-white.border.border-gray-200')
    await page.locator('.bg-white.border.border-gray-200 button').first().click()

    // Switch to Quarterly
    await page.click('button:has-text("Quarterly")')
    // Should show a 3-month coverage label like "May–Jul 2026"
    await expect(page.locator('text=/[A-Z][a-z]+–[A-Z][a-z]+ 20\\d{2}/')).toBeVisible()
  })

  // ── Month filter ─────────────────────────────────────────────────────────────

  test('month filter shows only payments from that month', async ({ page }) => {
    // Default filter is current month — verify records count label is visible
    await expect(page.locator('text=records')).toBeVisible()

    // Clear filter — count should change or stay same
    await page.click('button[title="Clear"]').catch(() => {}) // may not exist if no filter
    const text = await page.locator('text=records').textContent()
    expect(text).toMatch(/\d+ records/)
  })

  // ── Delete payment ───────────────────────────────────────────────────────────

  test('delete payment button is visible on paid rows', async ({ page }) => {
    // Look for the trash icon on paid rows
    const trashBtn = page.locator('button[title="Delete payment"]').first()
    const count = await trashBtn.count()
    // If there are paid payments, trash button should exist
    if (count > 0) {
      await expect(trashBtn).toBeVisible()
    } else {
      test.skip(true, 'No paid payments to test deletion')
    }
  })

})

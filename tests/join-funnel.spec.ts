import { test, expect, Page } from '@playwright/test'

// Edge tests for the public /join registration funnel (TrialEnroll.jsx) after
// the "Academy App v2" redesign.
//
// READ-ONLY BY CONSTRUCTION. /join browses anon-readable data (migration
// 0140), so nothing here writes. The suite deliberately stops short of
// submitting a registration: a submit needs a phone OTP and would create a
// real trial lead in the production database. Everything up to and including
// "the CTA is now live" is covered; the POST itself is not.

const skipLogin = async (page: Page) => {
  await page.goto('/join')
  const skip = page.getByText('Skip for now', { exact: false })
  await skip.waitFor({ state: 'visible', timeout: 20_000 })
  await skip.click()
  await expect(page.getByPlaceholder('Search sport, branch or batch')).toBeVisible({ timeout: 15_000 })
  // The search box lives in the sticky header and paints immediately, but the
  // sport grid is an async fetch. Callers use .count(), which does not wait —
  // so settle the grid here or every one of them races the fetch and sees zero.
  await expect(
    page.locator('[aria-label*="branch"]').first()
      .or(page.getByText('No sports listed yet'))
      .or(page.getByText('Nothing matches that'))
  ).toBeVisible({ timeout: 20_000 })
}

// The design's hard rule: wide content scrolls inside its own container, the
// page body never scrolls sideways. This is the single most common way a
// phone-first layout breaks, and it is invisible at 412px.
const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement
    return { scrollW: d.scrollWidth, clientW: d.clientWidth }
  })
  expect(overflow.scrollW, `page scrolls horizontally (${overflow.scrollW} > ${overflow.clientW})`)
    .toBeLessThanOrEqual(overflow.clientW + 1)
}

const firstSportCard = (page: Page) => page.locator('[aria-label*="branch"]').first()

test.describe('/join — entry', () => {
  test('login screen renders and Skip enters the funnel', async ({ page }) => {
    await page.goto('/join')
    await expect(page.getByText('Skip for now', { exact: false })).toBeVisible({ timeout: 20_000 })
    // Both auth tabs exist and neither is a dead end.
    await expect(page.getByText('Login', { exact: true })).toBeVisible()
    await expect(page.getByText('Register', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('98765 43210')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByText('Skip for now', { exact: false }).click()
    await expect(page.getByPlaceholder('Search sport, branch or batch')).toBeVisible({ timeout: 15_000 })
  })

  test('phone field accepts only digits and caps at 10', async ({ page }) => {
    await page.goto('/join')
    const phone = page.getByPlaceholder('98765 43210')
    await phone.waitFor({ state: 'visible', timeout: 20_000 })
    await phone.fill('')
    await phone.type('98a76b54321099')
    expect(await phone.inputValue()).toBe('9876543210')
  })
})

test.describe('/join — explore', () => {
  test.beforeEach(async ({ page }) => { await skipLogin(page) })

  test('header, hero and sport grid render from real data', async ({ page }) => {
    await expect(page.getByText('Admissions open')).toBeVisible()
    await expect(page.getByText('Book a free trial session')).toBeVisible()
    await expect(page.getByText('Get started')).toBeVisible()
    await expect(page.getByText('All programs')).toBeVisible()
    // The removed ₹0 badge must stay removed.
    await expect(page.getByText('To register')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })

  test('tab bar shows the three v2 tabs', async ({ page }) => {
    for (const t of ['Explore', 'Sessions', 'Academy']) {
      await expect(page.getByText(t, { exact: true })).toBeVisible()
    }
  })

  test('search with no match shows the empty state, and clearing restores', async ({ page }) => {
    const before = await page.locator('[aria-label*="branch"]').count()
    test.skip(before === 0, 'academy has no sports configured')

    await page.getByPlaceholder('Search sport, branch or batch').fill('zzzzznotasport')
    await expect(page.getByText('Nothing matches that')).toBeVisible()
    await page.getByText('Clear filters').click()
    await expect.poll(() => page.locator('[aria-label*="branch"]').count()).toBe(before)
  })

  test('bookmarking a sport does not navigate away', async ({ page }) => {
    const save = page.locator('[aria-label^="Save "]').first()
    test.skip(await save.count() === 0, 'no sports to bookmark')

    await save.click()
    // Still on Explore — stopPropagation must have held.
    await expect(page.getByPlaceholder('Search sport, branch or batch')).toBeVisible()
    await expect(page.locator('[aria-label^="Remove "]').first()).toBeVisible()
  })

  test('category chips filter without emptying the list wrongly', async ({ page }) => {
    const chips = page.locator('text=/^(Team|Racquet|Water)$/')
    test.skip(await chips.count() === 0, 'academy has no categorised sports')

    const label = await chips.first().innerText()
    await chips.first().click()
    await expect(page.getByText(`${label} sports`)).toBeVisible()
    // A category chip is only rendered when at least one sport is in it, so
    // selecting one must never produce zero results.
    await expect.poll(() => page.locator('[aria-label*="branch"]').count()).toBeGreaterThan(0)
  })
})

test.describe('/join — funnel navigation', () => {
  test.beforeEach(async ({ page }) => { await skipLogin(page) })

  test('sport → branch shows the stat row and branch cards', async ({ page }) => {
    const card = firstSportCard(page)
    test.skip(await card.count() === 0, 'no sports configured')
    await card.click()

    await expect(page.getByText('Choose a branch')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Batches', { exact: true })).toBeVisible()
    await expect(page.getByText('Trial fee', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('back from sport returns to Explore', async ({ page }) => {
    const card = firstSportCard(page)
    test.skip(await card.count() === 0, 'no sports configured')
    await card.click()
    await expect(page.getByText('Choose a branch')).toBeVisible({ timeout: 15_000 })

    await page.locator('[aria-label="Back to sports"]').click()
    await expect(page.getByPlaceholder('Search sport, branch or batch')).toBeVisible()
  })

  test('branch → batch or form, and the tab bar hides on the form', async ({ page }) => {
    const card = firstSportCard(page)
    test.skip(await card.count() === 0, 'no sports configured')
    await card.click()

    const branch = page.locator('[aria-label*="register here"]').first()
    test.skip(await branch.count() === 0, 'sport has no branches')
    await branch.click()

    // Either the batch picker (joinBatchChoice on) or straight to the form —
    // the batch list is an async fetch, so wait for whichever lands before
    // probing, or the probe races the render and always sees neither.
    await expect(
      page.getByText('Choose a batch').or(page.getByText('Registration'))
    ).toBeVisible({ timeout: 20_000 })
    const onBatch = await page.getByText('Choose a batch').isVisible().catch(() => false)
    if (onBatch) {
      await expect(page.getByText('Not sure yet', { exact: false })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.getByText('Not sure yet', { exact: false }).first().click()
    }

    await expect(page.getByText('Registration')).toBeVisible({ timeout: 15_000 })
    // The tab bar must step aside once the funnel commits.
    await expect(page.getByText('Explore', { exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('/join — registration form', () => {
  // Walk to the form once per test.
  const reachForm = async (page: Page) => {
    await skipLogin(page)
    const card = firstSportCard(page)
    if (await card.count() === 0) return false
    await card.click()
    const branch = page.locator('[aria-label*="register here"]').first()
    await branch.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    if (await branch.count() === 0) return false
    await branch.click()
    await expect(
      page.getByText('Choose a batch').or(page.getByText('Registration'))
    ).toBeVisible({ timeout: 20_000 })
    const notSure = page.getByText('Not sure yet', { exact: false })
    if (await notSure.count() > 0 && await notSure.first().isVisible()) await notSure.first().click()
    await page.getByText('Registration').waitFor({ state: 'visible', timeout: 15_000 })
    return true
  }

  test('starts at 0/6 with the CTA held shut', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    await expect(page.getByText('0/6')).toBeVisible()
    await expect(page.getByText('Complete required fields')).toBeVisible()
    // Greyed but NOT disabled: a disabled button refuses to say which field is
    // missing, and the tap that should scroll the parent to the empty box does
    // nothing. It must stay live so goToPayment can flag and scroll.
    const cta = page.locator('button', { hasText: 'Complete required fields' })
    await expect(cta).toBeEnabled()
  })

  test('tapping the held CTA flags the missing fields instead of doing nothing', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    // Fill everything except the student name, so exactly one thing is missing.
    await page.getByText('Male', { exact: true }).click()
    await page.locator('#jf-parentName').fill('Test Parent')
    await page.locator('#jf-emergencyContactName').fill('Test Emergency')
    await page.locator('#jf-emergencyContactPhone').fill('9876543210')
    await page.getByText('No', { exact: true }).click()
    await expect(page.getByText('5/6')).toBeVisible()

    await page.locator('button', { hasText: 'Complete required fields' }).click()
    // The offending field is called out in place rather than left to guesswork.
    await expect(page.getByText('Required').first()).toBeVisible()
    await expect(page.locator('#jf-name')).toBeInViewport()
  })

  test('age derives from date of birth and never disagrees with it', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    await page.locator('#jf-dob').fill('2015-06-15')
    const expected = String(new Date().getFullYear() - 2015 - (new Date() < new Date(`${new Date().getFullYear()}-06-15`) ? 1 : 0))
    await expect(page.getByText(expected, { exact: true }).first()).toBeVisible()
  })

  test('medical Yes reveals the note field, No hides and clears it', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    await page.getByText('Yes', { exact: true }).click()
    const notes = page.locator('#jf-medicalNotes')
    await expect(notes).toBeVisible()
    await notes.fill('Asthma — carries an inhaler')
    await page.getByText('No', { exact: true }).click()
    await expect(notes).toHaveCount(0)
    // Re-opening must not resurrect the cleared note.
    await page.getByText('Yes', { exact: true }).click()
    await expect(page.locator('#jf-medicalNotes')).toHaveValue('')
  })

  test('preferred days always store in week order however they are tapped', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    for (const d of ['Fri', 'Mon', 'Wed']) {
      await page.locator(`[aria-label^="${d}"]`).first().click()
    }
    const selected = await page.locator('[aria-label$="selected"]').allInnerTexts()
    expect(selected).toEqual(['Mon', 'Wed', 'Fri'])
  })

  test('completing every required field unlocks the CTA at 6/6', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')

    await page.locator('#jf-name').fill('Test Student')
    await page.getByText('Male', { exact: true }).click()
    await page.locator('#jf-parentName').fill('Test Parent')
    await page.locator('#jf-emergencyContactName').fill('Test Emergency')
    await page.locator('#jf-emergencyContactPhone').fill('9876543210')
    await page.getByText('No', { exact: true }).click()

    await expect(page.getByText('6/6')).toBeVisible()
    const cta = page.locator('button', { hasText: 'Continue' })
    await expect(cta).toBeEnabled()
    // Stop here on purpose — going further submits a real trial lead.
  })

  test('the emergency-contact shortcut copies the guardian name', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    await page.locator('#jf-parentName').fill('Rajesh Sharma')
    const chip = page.getByText('Use father / guardian')
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(page.locator('#jf-emergencyContactName')).toHaveValue('Rajesh Sharma')
  })

  test('an in-progress form survives a reload', async ({ page }) => {
    test.skip(!(await reachForm(page)), 'could not reach the form')
    await page.locator('#jf-name').fill('Draft Survivor')
    await page.waitForTimeout(400) // let the draft effect flush to sessionStorage
    await page.reload()
    await expect(page.getByText('Registration')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#jf-name')).toHaveValue('Draft Survivor')
  })
})

test.describe('/join — other tabs', () => {
  test.beforeEach(async ({ page }) => { await skipLogin(page) })

  test('Sessions tab asks an unverified visitor to verify', async ({ page }) => {
    await page.getByText('Sessions', { exact: true }).click()
    await expect(page.getByText('Verify your number')).toBeVisible()
    await expect(page.getByPlaceholder('98765 43210')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('Academy tab renders the academy card and returns to Explore', async ({ page }) => {
    await page.getByText('Academy', { exact: true }).click()
    await expect(page.getByText('Your registrations')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByText('Explore', { exact: true }).click()
    await expect(page.getByPlaceholder('Search sport, branch or batch')).toBeVisible()
  })
})

// Shared login helper — call at the start of every test
export async function loginAsOwner(page) {
  await page.goto('/login')
  await page.fill('input[type="email"]',    'owner@gmail.com')
  await page.fill('input[type="password"]', '123456')  // replace once
  await page.click('button[type="submit"]')
  await page.waitForURL('**/students', { timeout: 15000 })
}

// Fill the Add Student form with given data
export async function fillAddStudentForm(page, { name, phone, trainingType = 'Daily', fees = '', joinDate = '', paidTill = '' } = {}) {
  await page.click('button:has-text("Add Student")')
  await page.waitForSelector('text=Add New Student')

  await page.fill('input[placeholder="Full name"]', name)
  await page.fill('input[placeholder="10-digit number"]', phone)

  // Training type buttons
  await page.click(`button:has-text("${trainingType}")`)

  if (fees) {
    await page.fill('input[placeholder="e.g. 9000"]', String(fees))
  }
  if (joinDate) {
    await page.fill('input[type="date"][max]', joinDate)
  }
  if (paidTill) {
    // second date input (Paid Till)
    const dateInputs = page.locator('input[type="date"]')
    await dateInputs.nth(1).fill(paidTill)
  }
}

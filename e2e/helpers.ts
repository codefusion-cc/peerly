import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export type Person = { email: string; context: BrowserContext; page: Page }

/** An address no other test uses. */
export const address = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}@example.com`

/** Someone signed in on their own browser (a fresh context), on the home page. */
export async function signIn(browser: Browser, name: string, email = address(name)): Promise<Person> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await page.getByTestId('e2e-email').fill(email)
  await page.getByTestId('e2e-sign-in').click()
  await expect(page.getByRole('heading', { name: 'Workspaces', level: 1 })).toBeVisible()
  return { email, context, page }
}

/** Makes a workspace listing `emails` and waits in its first channel. */
export async function createWorkspace(page: Page, name: string, emails: string[]) {
  await page.getByRole('button', { name: 'New workspace' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New workspace' })
  await dialog.getByLabel('Name').fill(name)
  if (emails.length) await dialog.getByLabel('Invite by email').fill(`${emails.join(', ')} `)
  await dialog.getByRole('button', { name: 'Create workspace' }).click()
  await expect(channelHeading(page, 'general')).toBeVisible()
}

/** The invite link, as the owner copies it from the members dialog. */
export async function inviteLink(page: Page, workspace: string): Promise<string> {
  await page.getByRole('complementary', { name: workspace }).getByRole('button', { name: workspace }).click()
  await page.getByRole('menuitem', { name: 'Invite and members' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite and members' })
  await dialog.getByRole('button', { name: 'Copy invite link' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  return link
}

/** Opens an invite link and joins, landing in the workspace's first channel. */
export async function join(person: Person, link: string) {
  await person.page.goto(link)
  await person.page.getByRole('button', { name: 'Join workspace' }).click()
  await expect(channelHeading(person.page, 'general')).toBeVisible()
}

export const channelHeading = (page: Page, name: string) => page.getByRole('heading', { name, level: 1 })
export const messages = (page: Page, channel = 'general') => page.getByRole('log', { name: `Messages in #${channel}` })
export const message = (page: Page, text: string | RegExp, channel = 'general'): Locator =>
  messages(page, channel).getByRole('listitem').filter({ hasText: text })

export async function send(page: Page, text: string, channel = 'general') {
  const box = page.getByRole('textbox', { name: `Message #${channel}` })
  await box.fill(text)
  await box.press('Enter')
  await expect(message(page, text, channel)).toBeVisible()
}

/** Waits until two people have a direct link (each sees the other online, linked). */
export async function linked(page: Page) {
  await expect(page.getByTitle('1 direct link')).toBeVisible({ timeout: 30_000 })
}

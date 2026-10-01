import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createWorkspace, send, signIn } from './helpers.ts'

/**
 * No WCAG 2.2 AA violation on what is on screen now. Pages run with reduced
 * motion, which the app honours, so nothing is measured mid-transition.
 */
async function accessible(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(violations.map(violation => `${what}: ${violation.id} (${violation.nodes.map(node => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`).join('; ')})`)).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every main screen is accessible in ${colorScheme} mode`, async ({ browser }) => {
    const signInContext = await browser.newContext({ colorScheme, reducedMotion: 'reduce' })
    const signInPage = await signInContext.newPage()
    await signInPage.goto('/')
    await expect(signInPage.getByTestId('e2e-email')).toBeVisible()
    await accessible(signInPage, 'sign-in')
    await signInContext.close()

    const ala = await signIn(browser, 'ala')
    await ala.page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await accessible(ala.page, 'home, no workspaces')

    await ala.page.getByRole('button', { name: 'New workspace' }).first().click()
    await expect(ala.page.getByRole('dialog', { name: 'New workspace' })).toBeVisible()
    await accessible(ala.page, 'new workspace dialog')
    await ala.page.getByRole('dialog', { name: 'New workspace' }).getByRole('button', { name: 'Cancel' }).click()

    await createWorkspace(ala.page, 'Checks', [])
    await send(ala.page, 'A message with a link: https://example.com')
    await accessible(ala.page, 'channel')

    for (const section of ['account', 'devices', 'appearance', 'storage']) {
      await ala.page.goto(section === 'account' ? '/settings' : `/settings/${section}`)
      await expect(ala.page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
      await accessible(ala.page, `settings ${section}`)
    }
    await ala.context.close()
  })
}

test('the channel works with the keyboard alone', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  await createWorkspace(ala.page, 'Keys', [])
  await send(ala.page, 'First')
  const box = ala.page.getByRole('textbox', { name: 'Message #general' })

  // From the box, Shift+Tab reaches the message; Tab then walks its actions, and the menu opens on its first item.
  await box.focus()
  await ala.page.keyboard.press('Shift+Tab')
  await expect(ala.page.locator(':focus')).toContainText('First')
  await ala.page.keyboard.press('Tab')
  await expect(ala.page.locator(':focus')).toHaveAccessibleName('Add reaction')
  await ala.page.keyboard.press('Tab')
  await ala.page.keyboard.press('Tab')
  await ala.page.keyboard.press('Tab')
  await expect(ala.page.locator(':focus')).toHaveAccessibleName('More')
  await ala.page.keyboard.press('Enter')
  await expect(ala.page.locator(':focus')).toHaveText('Copy text')
  await ala.page.keyboard.press('Escape')
  await expect(ala.page.locator(':focus')).toHaveAccessibleName('More')
  await ala.context.close()
})

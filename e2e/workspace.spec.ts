import { expect, test } from '@playwright/test'
import { createWorkspace, inviteLink, join, linked, message, messages, send, signIn } from './helpers.ts'

test('two members talk directly: messages, replies, reactions, edits and deletions reach the other', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Design team', [bob.email])
  const link = await inviteLink(ala.page, 'Design team')
  expect(link).toMatch(/\/join#invite=/)
  await join(bob, link)
  await linked(ala.page)
  await linked(bob.page)

  await send(ala.page, 'Hello from Ala: https://example.com/plan.')
  // `.first()`: replies quote it further down.
  const hello = message(bob.page, 'Hello from Ala').first()
  await expect(hello).toBeVisible()
  // The link is a link, without the sentence's full stop, and opens safely.
  const anchor = hello.getByRole('link', { name: 'https://example.com/plan' })
  await expect(anchor).toHaveAttribute('href', 'https://example.com/plan')
  await expect(anchor).toHaveAttribute('rel', /noopener/)

  // Bob replies and reacts; Ala sees both.
  await hello.hover()
  await hello.getByRole('button', { name: 'Reply' }).click()
  await send(bob.page, 'Hi Ala')
  await expect(message(ala.page, 'Hi Ala')).toContainText('Hello from Ala')
  await hello.hover()
  await hello.getByRole('button', { name: 'Add reaction' }).click()
  await bob.page.getByRole('button', { name: 'React with 🎉' }).click()
  await expect(message(ala.page, 'Hello from Ala').first().getByRole('button', { name: /🎉 1/ })).toBeVisible()

  // Ala edits with ↑ and deletes; Bob sees the edit and then the deletion.
  const box = ala.page.getByRole('textbox', { name: 'Message #general' })
  await box.press('ArrowUp')
  await expect(box).toHaveValue('Hello from Ala: https://example.com/plan.')
  await box.press('End')
  await box.pressSequentially(' (updated)')
  await box.press('Enter')
  await expect(message(bob.page, '(updated)').first()).toContainText('edited')

  const edited = message(ala.page, '(updated)').first()
  await edited.hover()
  await edited.getByRole('button', { name: 'More' }).click()
  await ala.page.getByRole('menuitem', { name: 'Delete message' }).click()
  await ala.page.getByRole('dialog', { name: 'Delete message' }).getByRole('button', { name: 'Delete message' }).click()
  await expect(messages(bob.page).getByText('Message deleted', { exact: true }).first()).toBeVisible()
  await expect(message(bob.page, '(updated)')).toHaveCount(0)
  // The reply keeps its place, quoting a message that is gone.
  await expect(message(bob.page, 'Hi Ala')).toContainText('Message deleted')

  await ala.context.close()
  await bob.context.close()
})

test('a member who was away gets what was said once they are back', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Night shift', [bob.email])
  await join(bob, await inviteLink(ala.page, 'Night shift'))
  await linked(ala.page)
  const channelUrl = bob.page.url()
  await bob.page.close()

  // Only Ala's device holds these while Bob is away.
  await send(ala.page, 'Said while Bob was away')
  await send(ala.page, 'And one more')

  const back = await bob.context.newPage()
  await back.goto(channelUrl)
  await expect(message(back, 'Said while Bob was away')).toBeVisible({ timeout: 30_000 })
  await expect(message(back, 'And one more')).toBeVisible()
  // Each message once, in the order it was said.
  await expect(messages(back).getByRole('listitem').filter({ hasText: /Said while|And one more/ })).toHaveText([/Said while Bob was away/, /And one more/])

  await ala.context.close()
  await bob.context.close()
})

test('someone the owner did not list cannot get in, even with the link', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const eve = await signIn(browser, 'eve')
  await createWorkspace(ala.page, 'Private', [])
  const link = await inviteLink(ala.page, 'Private')

  await eve.page.goto(link)
  await expect(eve.page.getByRole('heading', { name: 'You are not on Private’s list' })).toBeVisible()
  await expect(eve.page.getByText(eve.email)).toBeVisible()
  await expect(eve.page.getByRole('button', { name: 'Join workspace' })).toHaveCount(0)

  await ala.context.close()
  await eve.context.close()
})

test('a changed invite link is refused', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Tampered', [bob.email])
  const link = await inviteLink(ala.page, 'Tampered')
  // Swap one character in the middle of the invite.
  const at = link.indexOf('#invite=') + 40
  const swapped = `${link.slice(0, at)}${link[at] === 'A' ? 'B' : 'A'}${link.slice(at + 1)}`

  await bob.page.goto(swapped)
  await expect(bob.page.getByRole('heading', { name: 'This invite does not work' })).toBeVisible()

  await ala.context.close()
  await bob.context.close()
})

test('files go between members directly: an image shows by itself, any file can be saved as it was sent', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Files', [bob.email])
  await join(bob, await inviteLink(ala.page, 'Files'))
  await linked(ala.page)

  // A real PNG (drawn in the page), and a text file with Polish letters.
  const png = await ala.page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    const context = canvas.getContext('2d')!
    context.fillStyle = '#0ea5e9'
    context.fillRect(0, 0, 320, 200)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  const notes = 'Notatki: zażółć gęślą jaźń\n'
  await ala.page.locator('input[type=file]').setInputFiles([
    { name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from(png) },
    { name: 'notatki.txt', mimeType: 'text/plain', buffer: Buffer.from(notes) },
  ])
  const tray = ala.page.getByRole('list', { name: 'Files to send' })
  await expect(tray.getByText('diagram.png')).toBeVisible()
  await expect(tray.getByText('Preparing…')).toHaveCount(0)
  await send(ala.page, 'Two files')

  const sent = message(bob.page, 'Two files')
  const image = sent.getByRole('button', { name: 'Open diagram.png' }).locator('img')
  // The preview comes inside the message; the image itself then comes from Ala's device.
  await expect(image).toHaveAttribute('src', /^blob:/, { timeout: 30_000 })

  const download = bob.page.waitForEvent('download')
  await sent.getByRole('button', { name: 'Save notatki.txt' }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('notatki.txt')
  const path = await saved.path()
  expect((await import('node:fs')).readFileSync(path, 'utf8')).toBe(notes)

  await ala.context.close()
  await bob.context.close()
})

test('a file nobody online has says so, and comes once its sender is back', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Later', [bob.email])
  await join(bob, await inviteLink(ala.page, 'Later'))
  await linked(ala.page)
  const channel = ala.page.url()
  await ala.page.locator('input[type=file]').setInputFiles([{ name: 'raport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 raport') }])
  await expect(ala.page.getByRole('list', { name: 'Files to send' }).getByText('Preparing…')).toHaveCount(0)
  await send(ala.page, 'The report')
  await expect(message(bob.page, 'The report')).toBeVisible()
  await ala.page.close()

  const card = message(bob.page, 'The report')
  await card.getByRole('button', { name: 'Save raport.pdf' }).click()
  await expect(card.getByText('Nobody who has this file is online.')).toBeVisible({ timeout: 30_000 })

  const back = await ala.context.newPage()
  await back.goto(channel)
  await linked(bob.page)
  const download = bob.page.waitForEvent('download')
  await card.getByRole('button', { name: 'Try raport.pdf again' }).click()
  expect((await download).suggestedFilename()).toBe('raport.pdf')

  await ala.context.close()
  await bob.context.close()
})

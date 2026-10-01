import { expect, test, type Page } from '@playwright/test'
import { createWorkspace, inviteLink, join, linked, signIn } from './helpers.ts'

/** The tracks a call tile plays, as its video element has them. */
const tileTracks = (page: Page, name: string) => page.getByRole('region', { name: 'Call' }).getByRole('listitem').filter({ hasText: name }).locator('video')
  .evaluate((video: HTMLVideoElement) => {
    const stream = video.srcObject as MediaStream | null
    return { audio: stream?.getAudioTracks().filter(track => track.readyState === 'live').length ?? 0, video: stream?.getVideoTracks().filter(track => track.readyState === 'live').length ?? 0 }
  })

test('two members talk in the workspace\'s call: each hears the other, and sees a camera once it is on', async ({ browser }) => {
  const ala = await signIn(browser, 'ala')
  const bob = await signIn(browser, 'bob')
  await createWorkspace(ala.page, 'Huddle', [bob.email])
  await join(bob, await inviteLink(ala.page, 'Huddle'))
  await linked(ala.page)

  await ala.page.getByRole('button', { name: 'Start a call' }).click()
  await expect(ala.page.getByRole('toolbar', { name: 'Call controls' })).toBeVisible()
  // Bob sees who is in it, and comes in from the bar.
  await expect(bob.page.getByText(/is in the call/)).toBeVisible()
  await bob.page.getByRole('button', { name: 'Join the call' }).last().click()
  await expect(bob.page.getByRole('toolbar', { name: 'Call controls' })).toBeVisible()

  const call = (page: Page) => page.getByRole('region', { name: 'Call' })
  await expect(call(ala.page).getByRole('listitem')).toHaveCount(2)
  await expect(call(bob.page).getByRole('listitem')).toHaveCount(2)
  // Each hears the other's microphone.
  await expect.poll(async () => (await tileTracks(bob.page, 'ala')).audio, { timeout: 30_000 }).toBe(1)
  await expect.poll(async () => (await tileTracks(ala.page, 'bob')).audio, { timeout: 30_000 }).toBe(1)

  // Ala turns her camera on: Bob gets the picture.
  await call(ala.page).getByRole('button', { name: 'Turn the camera on' }).click()
  await expect.poll(async () => (await tileTracks(bob.page, 'ala')).video, { timeout: 30_000 }).toBe(1)

  // Mute shows on her own tile; leaving takes her out of Bob's call.
  await call(ala.page).getByRole('button', { name: 'Mute the microphone' }).click()
  await expect(call(ala.page).getByLabel('Microphone off')).toBeVisible()
  await call(ala.page).getByRole('button', { name: 'Leave' }).click()
  await expect(call(bob.page).getByRole('listitem')).toHaveCount(1)
  await expect(ala.page.getByText(/^bob-.* is in the call$/)).toBeVisible()
  await expect(ala.page.getByRole('toolbar', { name: 'Call controls' })).toHaveCount(0)

  await ala.context.close()
  await bob.context.close()
})

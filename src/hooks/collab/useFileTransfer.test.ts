// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileCache } from '../../collab/fileCache'
import { FILES_NEED_CONNECTION_ERROR } from '../../collab/constants'
import { BlobUrlRegistry } from '../../utils/blobUrls'
import { useFileTransfer } from './useFileTransfer'

/** The hook as a channel uses it, with the browser's storage kept in memory. */
function renderTransfer() {
  const onFileMessage = vi.fn()
  const cache = new FileCache(async () => {}, async () => null)
  const { result } = renderHook(() => useFileTransfer(
    'general',
    { current: { name: 'Alice', color: '#336699' } },
    { current: undefined },
    cache,
    { current: new BlobUrlRegistry() },
    onFileMessage,
  ))
  return { result, onFileMessage }
}

const note = (name: string) => new File([`contents of ${name}`], name, { type: 'text/plain' })

describe('sharing a file from the composer', () => {
  it('says the file was not shared when the room is not connected yet', async () => {
    const { result } = renderTransfer()
    const shown = vi.fn()
    await act(() => result.current.sendFile(note('early.txt'), shown))
    expect(shown).not.toHaveBeenCalled()
    expect(result.current.fileError).toBe(FILES_NEED_CONNECTION_ERROR)
  })

  it('drops the "not connected" error as soon as the room connects', async () => {
    const { result } = renderTransfer()
    await act(() => result.current.sendFile(note('early.txt'), vi.fn()))
    act(() => result.current.bindFileMetaAction({ send: async () => {} }))
    expect(result.current.fileError).toBeNull()
  })

  it('keeps an unrelated error when the room connects', async () => {
    const { result } = renderTransfer()
    act(() => result.current.reportFileError('This original is waiting for a peer who has it.'))
    act(() => result.current.bindFileMetaAction({ send: async () => {} }))
    expect(result.current.fileError).toBe('This original is waiting for a peer who has it.')
  })

  it('shows the file and announces it once the room is connected', async () => {
    const { result } = renderTransfer()
    await act(() => result.current.sendFile(note('early.txt'), vi.fn()))
    const announce = vi.fn(async () => {})
    act(() => result.current.bindFileMetaAction({ send: announce }))

    const shown = vi.fn()
    await act(() => result.current.sendFile(note('later.txt'), shown))
    expect(shown).toHaveBeenCalledTimes(1)
    expect(shown.mock.calls[0][0]).toMatchObject({ type: 'file', file: { name: 'later.txt', size: 'contents of later.txt'.length } })
    expect(announce).toHaveBeenCalledWith(expect.objectContaining({ name: 'later.txt', channelId: 'general' }), undefined)
    expect(result.current.fileError).toBeNull()
  })
})

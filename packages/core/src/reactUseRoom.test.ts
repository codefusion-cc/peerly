/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PeerHandshake } from '@trystero-p2p/core'

/**
 * The signaling edge, with the one rule of Trystero's that matters here: while
 * a room is joined and not yet left, joining the same room id again returns
 * that same room instead of a new one. Each join resolves only when the test
 * says so, which is how a join that waits for the control session behaves.
 */
const signaling = vi.hoisted(() => {
  type FakeRoom = { id: number; left: boolean; leave: () => Promise<void>; getPeers: () => object }
  const occupied = new Map<string, FakeRoom>()
  const pending: Array<() => void> = []
  let made = 0
  return {
    occupied,
    pending,
    asked: 0,
    rooms: [] as FakeRoom[],
    join(roomId: string): Promise<FakeRoom> {
      signaling.asked += 1
      return new Promise(resolve => {
        pending.push(() => {
          const existing = occupied.get(roomId)
          if (existing) return resolve(existing)
          const room: FakeRoom = {
            id: ++made,
            left: false,
            getPeers: () => ({}),
            // Leaving takes a moment: Trystero tells the room before it lets go.
            leave: async () => {
              await new Promise(resolve => setTimeout(resolve, 20))
              room.left = true
              if (occupied.get(roomId) === room) occupied.delete(roomId)
            },
          }
          occupied.set(roomId, room)
          signaling.rooms.push(room)
          resolve(room)
        })
      })
    },
    reset() {
      occupied.clear()
      pending.length = 0
      signaling.rooms.length = 0
      signaling.asked = 0
      made = 0
    },
  }
})

vi.mock('./joinRoom.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./joinRoom.js')>()),
  joinRoomByCode: ({ roomId }: { roomId: string }) => signaling.join(roomId),
}))

const { useRoom } = await import('./react.js')

const ENV = { VITE_APP_ID: 'peerly', VITE_SIGNALING: 'nostr' }
const handshake = (): PeerHandshake => async () => {}

afterEach(() => signaling.reset())

/** Waits until the hook has asked to join `count` times in all. */
const joinsAsked = (count: number) => waitFor(() => expect(signaling.asked).toBe(count))

/** Settles the oldest join still waiting. */
async function settleNextJoin() {
  await act(async () => { signaling.pending.shift()?.() })
}

describe('useRoom', () => {
  it('ends on a live room when its options change while the first join is still under way', async () => {
    const { result, rerender } = renderHook(
      ({ onPeerHandshake }) => useRoom({ appId: 'peerly', roomId: 'workspace', env: ENV, onPeerHandshake }),
      { initialProps: { onPeerHandshake: handshake() } },
    )
    await joinsAsked(1)
    // A profile change hands the hook a new handshake before the join answered.
    rerender({ onPeerHandshake: handshake() })

    await settleNextJoin()
    await joinsAsked(2)
    await settleNextJoin()

    await waitFor(() => expect(result.current.room).not.toBeNull())
    // Every leave under way has finished by now.
    await act(() => new Promise(resolve => setTimeout(resolve, 100)))
    const room = result.current.room as unknown as { id: number; left: boolean }
    expect(room.left).toBe(false)
    expect(signaling.rooms.map(r => r.left)).toEqual([true, false])
    expect(room.id).toBe(2)
  })

  it('leaves the room it joined when it unmounts mid-join, and joins nothing else', async () => {
    const { unmount } = renderHook(() => useRoom({ appId: 'peerly', roomId: 'workspace', env: ENV }))
    await joinsAsked(1)
    unmount()
    await settleNextJoin()
    await waitFor(() => expect(signaling.rooms[0]?.left).toBe(true))
    expect(signaling.asked).toBe(1)
    expect(signaling.occupied.size).toBe(0)
  })
})

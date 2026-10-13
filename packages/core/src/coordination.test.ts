import { describe, expect, it } from 'vitest'
import {
  coordinationScope,
  openCoordinationData,
  sealCoordinationData,
} from './coordination.js'

describe('coordination data', () => {
  it('encrypts workspace metadata and rejects the wrong secret', async () => {
    const firstScope = await coordinationScope('workspace:a', 'secret')
    const secondScope = await coordinationScope('workspace:a', 'secret')
    expect(firstScope).toBe(secondScope)
    expect(firstScope).not.toContain('secret')

    const wire = await sealCoordinationData('secret', 'presence', { name: 'Alice' })
    await expect(openCoordinationData('secret', 'presence', wire)).resolves.toEqual({ name: 'Alice' })
    await expect(openCoordinationData('wrong', 'presence', wire)).resolves.toBeNull()
  })
})

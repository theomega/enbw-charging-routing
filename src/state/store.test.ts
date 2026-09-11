import { describe, expect, it } from 'vitest'
import { PERSIST_VERSION } from './store'

describe('persisted settings version', () => {
  it('is wired to the current persist version', () => {
    expect(PERSIST_VERSION).toBe(5)
  })
})

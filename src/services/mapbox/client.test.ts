import { describe, expect, it } from 'vitest'
import { isPlaceholderToken } from './client'

describe('isPlaceholderToken', () => {
  it('treats a missing or example token as unset', () => {
    expect(isPlaceholderToken(undefined)).toBe(true)
    expect(isPlaceholderToken('')).toBe(true)
    expect(isPlaceholderToken('   ')).toBe(true)
    // the literal value shipped in .env.example
    expect(isPlaceholderToken('pk.xxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true)
  })

  it('rejects a secret token pasted in by mistake', () => {
    expect(isPlaceholderToken('sk.abc123')).toBe(true)
  })

  it('accepts a real public token', () => {
    expect(isPlaceholderToken('pk.eyJ1IjoiZG9tIiwiYSI6ImNr')).toBe(false)
  })
})

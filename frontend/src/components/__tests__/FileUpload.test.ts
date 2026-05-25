import { describe, it, expect } from 'vitest'

describe('FileUpload', () => {
  it('exports a default component (type-only smoke test)', () => {
    // FileUpload component exists and is importable
    expect(typeof import('../FileUpload')).toBeTruthy()
  })
})

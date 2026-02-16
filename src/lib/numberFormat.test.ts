import { describe, expect, it } from 'vitest'
import { formatCompactStat } from './numberFormat'

describe('formatCompactStat', () => {
  it('keeps small values as whole numbers', () => {
    expect(formatCompactStat(0)).toBe('0')
    expect(formatCompactStat(999)).toBe('999')
  })

  it('formats thousands with lowercase k', () => {
    expect(formatCompactStat(1_000)).toBe('1k')
    expect(formatCompactStat(1_250)).toBe('1.3k')
    expect(formatCompactStat(23_683)).toBe('23.7k')
    expect(formatCompactStat(236_830)).toBe('237k')
  })

  it('formats millions with uppercase M', () => {
    expect(formatCompactStat(1_000_000)).toBe('1M')
    expect(formatCompactStat(2_360_000)).toBe('2.4M')
    expect(formatCompactStat(23_683_000)).toBe('23.7M')
  })

  it('preserves sign for negative values', () => {
    expect(formatCompactStat(-1_500)).toBe('-1.5k')
    expect(formatCompactStat(-2_500_000)).toBe('-2.5M')
  })
})

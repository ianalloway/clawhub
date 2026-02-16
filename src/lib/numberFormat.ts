export function formatCompactStat(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)

  if (absolute < 1_000) {
    return `${Math.round(value)}`
  }

  if (absolute < 1_000_000) {
    return `${sign}${formatUnit(absolute / 1_000)}k`
  }

  return `${sign}${formatUnit(absolute / 1_000_000)}M`
}

function formatUnit(scaled: number): string {
  const decimals = scaled < 100 ? 1 : 0
  const factor = 10 ** decimals
  const rounded = Math.round(scaled * factor) / factor
  return stripTrailingZero(rounded.toFixed(decimals))
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, '')
}

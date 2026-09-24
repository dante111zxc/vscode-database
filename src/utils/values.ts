export function toPlainString(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  if (value instanceof Date || value instanceof Uint8Array) {
    return value instanceof Date ? value.toISOString() : value.toString()
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'object') {
    return toPlainString(value)
  }
  return value
}

export function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(row)) {
      out[key] = sanitizeValue(row[key])
    }
    return out
  })
}
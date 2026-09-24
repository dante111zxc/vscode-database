import { toPlainString } from './values'

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const text = toPlainString(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(escapeCsvField).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

function pushCell(cells: string[], cell: string): void {
  cells.push(cell)
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += char
      i += 1
      continue
    }
    if (char === '"') {
      quoted = true
      i += 1
      continue
    }
    if (char === ',') {
      pushCell(cells, cell)
      cell = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      pushCell(cells, cell)
      cell = ''
      rows.push(cells)
      cells = []
      i += 1
      continue
    }
    cell += char
    i += 1
  }
  if (cell.length > 0 || cells.length > 0) {
    pushCell(cells, cell)
    rows.push(cells)
  }
  return rows
}
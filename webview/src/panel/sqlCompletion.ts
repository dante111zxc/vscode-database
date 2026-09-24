import type { SchemaInfo } from './panelStore'

export const SQL_KEYWORDS: string[] = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'TRUNCATE', 'TABLE', 'INDEX', 'VIEW', 'SCHEMA', 'DATABASE', 'AS', 'AND', 'OR',
  'NOT', 'NULL', 'IS', 'IN', 'EXISTS', 'LIKE', 'BETWEEN', 'ALL', 'ANY', 'SOME',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'JOIN', 'ON', 'CROSS', 'UNION',
  'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG',
  'MIN', 'MAX', 'NOW', 'CURRENT_TIMESTAMP', 'PRIMARY KEY', 'FOREIGN KEY',
  'REFERENCES', 'WITH', 'ASC', 'DESC',
]

interface Suggestion {
  text: string
  kind: 'keyword' | 'table' | 'column'
}

function scopeFromSql(sqlBeforeCursor: string): 'table' | 'column' | 'keyword' {
  const last = sqlBeforeCursor.trimEnd()
  const tail = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(last)
  if (tail) {
    return tableTriggerSet.has(tail[1].toUpperCase()) ? 'table' : 'keyword'
  }
  const trigger = /(FROM|JOIN|INTO|UPDATE|USING|TABLE)\s*$/i.exec(last)
  if (trigger) {
    return 'table'
  }
  const column = /(SELECT|WHERE|HAVING|ON|SET|VALUES|GROUP BY|ORDER BY|AND|OR)\s*$/i.exec(last)
  if (column) {
    return 'column'
  }
  return 'keyword'
}

const tableTriggerSet = new Set<string>([
  'FROM', 'JOIN', 'INTO', 'UPDATE', 'USING', 'TABLE',
])

export function currentWord(sql: string, pos: number): { word: string; start: number } {
  const before = sql.slice(0, pos)
  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)
  return match ? { word: match[0], start: pos - match[0].length } : { word: '', start: pos }
}

interface DotRef {
  table: string
  partial: string
  start: number
}

function dotRef(sql: string, pos: number): DotRef | null {
  const before = sql.slice(0, pos)
  const lastDot = before.lastIndexOf('.')
  if (lastDot < 0) {
    return null
  }
  const beforeDot = before.slice(0, lastDot)
  const table = /[A-Za-z_][A-Za-z0-9_]*$/.exec(beforeDot)
  if (!table) {
    return null
  }
  const partial = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(lastDot + 1, pos))
  const partialText = partial?.[0] ?? ''
  if (partial && partial[0].length !== pos - (lastDot + 1)) {
    return null
  }
  return { table: table[0], partial: partialText, start: lastDot + 1 }
}

export function suggestionStart(sql: string, pos: number): number {
  const ref = dotRef(sql, pos)
  return ref ? ref.start : currentWord(sql, pos).start
}

export function buildSuggestions(
  schema: SchemaInfo,
  sql: string,
  pos: number
): Suggestion[] {
  const ref = dotRef(sql, pos)
  const { word } = currentWord(sql, pos)
  const lower = word.toLowerCase()
  const scope = scopeFromSql(sql.slice(0, pos))

  const all: Suggestion[] = []
  const seen = new Set<string>()

  const push = (text: string, kind: Suggestion['kind']) => {
    const key = `${kind}:${text}`
    if (!seen.has(key)) {
      seen.add(key)
      all.push({ text, kind })
    }
  }

  if (ref) {
    const partial = ref.partial.toLowerCase()
    const table = schema.tables.find((t) => t.name.toLowerCase() === ref.table.toLowerCase())
    const sources = table ? [table] : schema.tables
    for (const src of sources) {
      for (const column of src.columns) {
        if (column.toLowerCase().startsWith(partial)) {
          push(column, 'column')
        }
      }
    }
    return all.slice(0, 50)
  }

  if (scope === 'table') {
    for (const table of schema.tables) {
      if (table.name.toLowerCase().startsWith(lower)) {
        push(table.name, 'table')
      }
    }
  } else if (scope === 'column') {
    for (const table of schema.tables) {
      for (const column of table.columns) {
        if (column.toLowerCase().startsWith(lower)) {
          push(column, 'column')
        }
      }
    }
    for (const keyword of SQL_KEYWORDS) {
      if (keyword.toLowerCase().startsWith(lower)) {
        push(keyword, 'keyword')
      }
    }
  } else {
    for (const keyword of SQL_KEYWORDS) {
      if (keyword.toLowerCase().startsWith(lower)) {
        push(keyword, 'keyword')
      }
    }
    for (const table of schema.tables) {
      if (table.name.toLowerCase().startsWith(lower)) {
        push(table.name, 'table')
      }
    }
  }

  return all.slice(0, 50)
}

export function canShowSuggestion(sql: string, pos: number): boolean {
  if (pos === 0) {
    return true
  }
  const before = sql.slice(0, pos)
  if (before.trim() === '') {
    return false
  }
  if (dotRef(sql, pos)) {
    return true
  }
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)
  if (word && word[0]) {
    return !isKeywordToken(word[0])
  }
  const last = before.trimEnd()
  return /\s$/.test(last) && /(FROM|JOIN|INTO|UPDATE|SELECT|WHERE|TABLE)\s*$/i.test(last)
}

const KEYWORD_TOKENS = new Set<string>(
  SQL_KEYWORDS.flatMap((k) => k.split(/\s+/)).map((w) => w.toUpperCase())
)

export function isKeywordToken(word: string): boolean {
  return KEYWORD_TOKENS.has(word.toUpperCase())
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatSql(sql: string): string {
  const pattern = new RegExp(
    `\\b(${SQL_KEYWORDS.map((k) => k.split(/\s+/).map(escapeRe).join('\\s+')).join('|')})\\b`,
    'gi'
  )
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      out += sql.slice(i, Math.min(j + 1, sql.length))
      i = j + 1
    } else {
      let j = i
      while (j < sql.length && sql[j] !== "'" && sql[j] !== '"' && sql[j] !== '`') {
        j += 1
      }
      out += sql.slice(i, j).replace(pattern, (m) => m.toUpperCase())
      i = j
    }
  }
  return out
}

export function kindLabel(kind: Suggestion['kind']): string {
  switch (kind) {
    case 'table':
      return 'TBL'
    case 'column':
      return 'COL'
    default:
      return 'KEY'
  }
}
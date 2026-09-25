import path from 'node:path'
import * as ExcelJS from 'exceljs'
import { toCsv, parseCsv } from './csv'

export type TransferFormat = 'csv' | 'sql' | 'json' | 'xml' | 'xlsx' | 'dump' | 'tar'

export const TRANSFER_EXTENSIONS: Record<TransferFormat, string> = {
  csv: 'csv',
  sql: 'sql',
  json: 'json',
  xml: 'xml',
  xlsx: 'xlsx',
  dump: 'dump',
  tar: 'tar',
}

export interface ExportTableData {
  type: string
  database?: string
  schema?: string
  table: string
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface ExportDbTable {
  name: string
  schema?: string
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface ImportTableData {
  columns: string[]
  rows: unknown[][]
}

export interface ImportDbTable {
  name: string
  schema?: string
  columns: string[]
  rows: unknown[][]
}

function quoteIdentifier(value: string, type: string): string {
  if (!value) {
    throw new Error('Database object name is required')
  }
  if (type === 'postgresql' || type === 'sqlite') {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `\`${value.replace(/`/g, '``')}\``
}

function qualifiedName(type: string, table: string, database?: string, schema?: string): string {
  const quoted = quoteIdentifier(table, type)
  if (type === 'postgresql') {
    return schema ? `${quoteIdentifier(schema, type)}.${quoted}` : quoted
  }
  if (type === 'mysql' || type === 'mariadb') {
    return database ? `${quoteIdentifier(database, type)}.${quoted}` : quoted
  }
  return quoted
}

function sqlValue(value: unknown, type: string): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'boolean') {
    return type === 'postgresql' ? (value ? 'true' : 'false') : value ? '1' : '0'
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  const s = String(value)
  if (type === 'sqlite') {
    return `'${s.replace(/'/g, "''")}'`
  }
  if (type === 'postgresql') {
    return `'${s.replace(/'/g, "''")}'`
  }
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

export function renderInsertStatement(
  type: string,
  table: string,
  database: string | undefined,
  schema: string | undefined,
  columns: string[],
  row: Record<string, unknown>
): string {
  const name = qualifiedName(type, table, database, schema)
  const cols = columns.map((c) => quoteIdentifier(c, type)).join(', ')
  const values = columns.map((c) => sqlValue(row[c], type)).join(', ')
  return `INSERT INTO ${name} (${cols}) VALUES (${values});`
}

export function renderTable(format: TransferFormat, data: ExportTableData): Buffer {
  switch (format) {
    case 'csv':
      return Buffer.from(toCsv(data.columns, data.rows), 'utf8')
    case 'sql':
      return Buffer.from(
        data.rows.map((r) => renderInsertStatement(data.type, data.table, data.database, data.schema, data.columns, r)).join('\n'),
        'utf8'
      )
    case 'json':
      return Buffer.from(
        JSON.stringify(
          {
            type: 'database-manager',
            table: data.table,
            database: data.database,
            schema: data.schema,
            columns: data.columns,
            rows: data.rows,
          },
          null,
          2
        ),
        'utf8'
      )
    case 'xml': {
      const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
      lines.push(
        `<table name="${escapeXml(data.table)}"${data.schema ? ` schema="${escapeXml(data.schema)}"` : ''}>`
      )
      for (const row of data.rows) {
        const cells = data.columns
          .map((c) => `<column name="${escapeXml(c)}">${escapeXml(cellText(row[c]))}</column>`)
          .join('')
        lines.push(`  <row>${cells}</row>`)
      }
      lines.push('</table>')
      return Buffer.from(lines.join('\n'), 'utf8')
    }
    case 'xlsx':
      throw new Error('Use renderWorkbook for XLSX output')
    default:
      return Buffer.alloc(0)
  }
}

export async function renderWorkbook(
  tables: { name: string; schema?: string; columns: string[]; rows: Record<string, unknown>[] }[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  for (const table of tables) {
    const worksheet = workbook.addWorksheet(sanitizeSheetName(table.schema ? `${table.schema}_${table.name}` : table.name))
    worksheet.addRow(table.columns)
    for (const row of table.rows) {
      worksheet.addRow(table.columns.map((c) => normalizeCellValue(row[c])))
    }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export function renderSingleWorkbook(
  data: ExportTableData
): Promise<Buffer> {
  return renderWorkbook([
    { name: data.table, schema: data.schema, columns: data.columns, rows: data.rows },
  ])
}

export function renderDatabase(
  format: Exclude<TransferFormat, 'csv' | 'xlsx' | 'dump' | 'tar'>,
  type: string,
  database: string,
  tables: ExportDbTable[]
): Buffer {
  switch (format) {
    case 'sql':
      return Buffer.from(
        tables
          .map(
            (t) =>
              `--\n-- Export of table ${t.name}\n--\n` +
              t.rows.map((r) => renderInsertStatement(type, t.name, database, t.schema, t.columns, r)).join('\n')
          )
          .join('\n\n'),
        'utf8'
      )
    case 'json':
      return Buffer.from(
        JSON.stringify(
          {
            type: 'database-manager',
            database,
            tables: tables.map((t) => ({
              name: t.name,
              schema: t.schema,
              columns: t.columns,
              rows: t.rows,
            })),
          },
          null,
          2
        ),
        'utf8'
      )
    case 'xml': {
      const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<database>']
      for (const t of tables) {
        lines.push(`  <table name="${escapeXml(t.name)}"${t.schema ? ` schema="${escapeXml(t.schema)}"` : ''}>`)
        for (const row of t.rows) {
          const cells = t.columns
            .map((c) => `<column name="${escapeXml(c)}">${escapeXml(cellText(row[c]))}</column>`)
            .join('')
          lines.push(`    <row>${cells}</row>`)
        }
        lines.push('  </table>')
      }
      lines.push('</database>')
      return Buffer.from(lines.join('\n'), 'utf8')
    }
    default:
      return Buffer.alloc(0)
  }
}

export function parseTableImport(
  format: Exclude<TransferFormat, 'dump' | 'tar'>,
  content: Buffer,
  filePath?: string
): Promise<ImportTableData> {
  switch (format) {
    case 'csv': {
      const parsed = parseCsv(content.toString('utf8'))
      const header = parsed[0] ?? []
      return Promise.resolve({ columns: header.filter((c) => c.length > 0), rows: parsed.slice(1).map((r) => r.slice(0, header.length)) })
    }
    case 'json': {
      const data = JSON.parse(content.toString('utf8'))
      if (Array.isArray(data)) {
        const columns = data.length > 0 ? Object.keys(data[0]) : []
        return Promise.resolve({ columns, rows: data.map((o) => columns.map((c) => o?.[c] ?? null)) })
      }
      const rows = (data?.rows ?? []) as Record<string, unknown>[]
      const columns = (data?.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : [])) as string[]
      return Promise.resolve({ columns, rows: rows.map((o) => columns.map((c) => o?.[c] ?? null)) })
    }
    case 'xml': {
      const doc = parseSimpleXml(content.toString('utf8'))
      const tableEl = doc.name === 'table' ? doc : doc.children.find((c) => c.name === 'table')
      if (!tableEl) {
        return Promise.resolve({ columns: [], rows: [] })
      }
      const rowsEl = tableEl.children.filter((c) => c.name === 'row')
      const columns = (tableEl.children[0]?.children ?? []).map((c) => c.attrs.name ?? '')
      return Promise.resolve({
        columns,
        rows: rowsEl.map((row) =>
          columns.map(
            (c) => (unescapeXml(row.children.find((cell) => cell.attrs.name === c)?.text ?? '') as unknown)
          )
        ),
      })
    }
    case 'xlsx':
      return readWorkbook(content, filePath)
    default:
      return Promise.resolve({ columns: [], rows: [] })
  }
}

export async function parseDatabaseImport(
  format: Exclude<TransferFormat, 'dump' | 'tar'>,
  content: Buffer,
  filePath?: string
): Promise<ImportDbTable[]> {
  switch (format) {
    case 'csv': {
      const tableData = await parseTableImport('csv', content, filePath)
      return [{ name: basenameNoExt(filePath ?? 'data.csv'), schema: undefined, ...tableData }]
    }
    case 'json': {
      const data = JSON.parse(content.toString('utf8'))
      if (Array.isArray(data?.tables)) {
        return (data.tables as Record<string, unknown>[]).map((t) => {
          const rows = (t.rows ?? []) as Record<string, unknown>[]
          const columns = (t.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : [])) as string[]
          return {
            name: String(t.name ?? ''),
            schema: typeof t.schema === 'string' ? t.schema : undefined,
            columns,
            rows: rows.map((o) => columns.map((c) => o?.[c] ?? null)),
          }
        })
      }
      return [{ name: basenameNoExt(filePath ?? 'data.json'), schema: undefined, ...(await parseTableImport('json', content, filePath)) }]
    }
    case 'xml': {
      const doc = parseSimpleXml(content.toString('utf8'))
      const tables = doc.name === 'database' ? doc.children : [doc]
      return tables
        .filter((t) => t.name === 'table')
        .map((tableEl) => {
          const schema = typeof tableEl.attrs.schema === 'string' ? tableEl.attrs.schema : undefined
          const columns = (tableEl.children[0]?.children ?? []).map((c) => c.attrs.name ?? '')
          const rows = tableEl.children
            .filter((c) => c.name === 'row')
            .map((row) =>
              columns.map(
                (c) => (unescapeXml(row.children.find((cell) => cell.attrs.name === c)?.text ?? '') as unknown)
              )
            )
          return { name: tableEl.attrs.name ?? '', schema, columns, rows }
        })
    }
    case 'xlsx':
      return readWorkbookTables(content, filePath)
    default:
      return []
  }
}

async function readWorkbook(content: Buffer, filePath?: string): Promise<ImportTableData> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(toArrayBuffer(content))
  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { columns: [], rows: [] }
  }
  const values = sheetValues(worksheet)
  const header = values[0] ?? []
  const rows = values.slice(1)
  return {
    columns: header.map(String).filter(() => true),
    rows: rows.map((r) => r.slice(0, header.length)),
  }
}

async function readWorkbookTables(content: Buffer, _filePath?: string): Promise<ImportDbTable[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(toArrayBuffer(content))
  const tables: ImportDbTable[] = []
  for (const worksheet of workbook.worksheets) {
    const values = sheetValues(worksheet)
    if (values.length === 0) {
      continue
    }
    const header = values[0]
    const columns = header.map(String)
    tables.push({
      name: worksheet.name,
      schema: undefined,
      columns,
      rows: values.slice(1).map((r) => r.slice(0, header.length)),
    })
  }
  return tables
}

function sheetValues(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: unknown[] = []
    let hasValue = false
    for (let i = 1; i <= row.cellCount; i++) {
      const cellValue = row.getCell(i).value
      const normalized = normalizeCellValue(cellValue)
      if (normalized !== null && normalized !== undefined && normalized !== '') {
        hasValue = true
      }
      values.push(normalized)
    }
    while (values.length > 0 && (values[values.length - 1] === null || values[values.length - 1] === undefined)) {
      values.pop()
    }
    if (values.length > 0 || hasValue) {
      rows.push(values)
    }
  })
  return rows
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.hyperlink === 'string' && record.text !== undefined) {
      return record.text ?? null
    }
    if (record.result !== undefined) {
      return record.result ?? null
    }
    if (record.text !== undefined) {
      return record.text ?? null
    }
    if (record.error !== undefined) {
      return null
    }
  }
  return value
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-' && !inSingle && !inDouble && !inBacktick) {
      while (i < sql.length && sql[i] !== '\n') {
        i++
      }
      i--
      continue
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble
      current += ch
      continue
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick
      current += ch
      continue
    }
    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
      current = ''
      continue
    }
    current += ch
  }
  const trimmed = current.trim()
  if (trimmed) {
    statements.push(trimmed)
  }
  return statements
}

interface XmlElement {
  name: string
  attrs: Record<string, string>
  text: string
  children: XmlElement[]
}

interface XmlNodeBuilder {
  name: string
  attrs: Record<string, string>
  textParts: string[]
  children: XmlElement[]
}

function parseSimpleXml(xml: string): XmlElement {
  const stack: XmlNodeBuilder[] = []
  let root: XmlElement | null = null
  let i = 0
  while (i < xml.length) {
    const open = xml.indexOf('<', i)
    if (open < 0) {
      appendText(stack, xml.slice(i))
      i = xml.length
      continue
    }
    if (open > i) {
      appendText(stack, xml.slice(i, open))
    }
    const close = xml.indexOf('>', open)
    if (close < 0) {
      break
    }
    const tag = xml.slice(open + 1, close)
    i = close + 1
    if (tag.startsWith('?') || tag.startsWith('!')) {
      continue
    }
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim()
      const node = stack.pop()
      if (node && node.name === name) {
        const element = toElement(node)
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(element)
        } else {
          root = element
        }
      }
      continue
    }
    if (tag.endsWith('/')) {
      const selfClosing = { ...parseTag(tag.slice(0, -1)), text: '', children: [] }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(selfClosing)
      }
      continue
    }
    const node: XmlNodeBuilder = { ...parseTag(tag), textParts: [], children: [] }
    stack.push(node)
  }
  while (stack.length > 0) {
    const node = stack.pop()
    if (node) {
      const element = toElement(node)
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(element)
      } else {
        root = element
      }
    }
  }
  return root ?? { name: '', attrs: {}, text: '', children: [] }
}

function appendText(stack: XmlNodeBuilder[], text: string): void {
  const node = stack[stack.length - 1]
  if (node && text) {
    node.textParts.push(text)
  }
}

function parseTag(raw: string): { name: string; attrs: Record<string, string> } {
  const trimmed = raw.trim()
  const spaceIndex = trimmed.search(/\s/)
  const name = spaceIndex < 0 ? trimmed : trimmed.slice(0, spaceIndex)
  const attrs: Record<string, string> = {}
  const attrSource = spaceIndex < 0 ? '' : trimmed.slice(spaceIndex)
  const attrRegex = /([^\s=]+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = attrRegex.exec(attrSource)) !== null) {
    attrs[match[1]] = match[2]
  }
  return { name, attrs }
}

function toElement(node: XmlNodeBuilder): XmlElement {
  return {
    name: node.name,
    attrs: node.attrs,
    text: node.textParts.join(''),
    children: node.children,
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31)
  return cleaned || 'Sheet1'
}

function basenameNoExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

function toArrayBuffer(content: Buffer): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
}

export { unescapeXml }
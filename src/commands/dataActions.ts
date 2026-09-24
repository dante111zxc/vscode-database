import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConnectionManager } from '../database/ConnectionManager'
import type { QueryResult } from '../database/types'
import { toCsv, parseCsv } from '../utils/csv'

export interface TableRef {
  connectionId: string
  database?: string
  schema?: string
  table: string
}

export interface SchemaRef {
  connectionId: string
  database?: string
  schema: string
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

function placeholders(type: string, count: number): string[] {
  if (type === 'postgresql') {
    return Array.from({ length: count }, (_, i) => `$${i + 1}`)
  }
  return Array(count).fill('?')
}

async function ensureConnection(
  manager: ConnectionManager,
  connectionId: string
): Promise<{ type: string; database?: string }> {
  if (!manager.isConnected(connectionId)) {
    await manager.connect(connectionId)
  }
  const connection = await manager.getConnection(connectionId)
  if (!connection) {
    throw new Error('Connection not found')
  }
  return { type: connection.type, database: connection.database }
}

function nodeExec(manager: ConnectionManager, connectionId: string, database: string | undefined) {
  return {
    execute: (sql: string, parameters?: unknown[]): Promise<QueryResult> => {
      const driver = manager.getDriver(connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      return driver.execute(sql, { database, parameters })
    },
    driver: (): NonNullable<ReturnType<typeof manager.getDriver>> => {
      const driver = manager.getDriver(connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      return driver
    },
  }
}

function refreshTree(): void {
  void vscode.commands.executeCommand('database-manager.refresh')
}

function fileSafeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export async function dropTable(manager: ConnectionManager, ref: TableRef): Promise<void> {
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const confirm = await vscode.window.showWarningMessage(
    `Drop table ${ref.table}? This cannot be undone.`,
    { modal: true },
    'Drop'
  )
  if (confirm !== 'Drop') {
    return
  }
  const sql = `DROP TABLE IF EXISTS ${qualifiedName(type, ref.table, ref.database ?? database, ref.schema)}`
  await nodeExec(manager, ref.connectionId, ref.database).execute(sql)
  vscode.window.showInformationMessage(`Dropped table ${ref.table}`)
  refreshTree()
}

export async function truncateTable(manager: ConnectionManager, ref: TableRef): Promise<void> {
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const confirm = await vscode.window.showWarningMessage(
    `Truncate table ${ref.table}? All rows will be removed.`,
    { modal: true },
    'Truncate'
  )
  if (confirm !== 'Truncate') {
    return
  }
  const name = qualifiedName(type, ref.table, ref.database ?? database, ref.schema)
  const sql = type === 'sqlite' ? `DELETE FROM ${name}` : `TRUNCATE TABLE ${name}`
  await nodeExec(manager, ref.connectionId, ref.database).execute(sql)
  vscode.window.showInformationMessage(`Truncated table ${ref.table}`)
  refreshTree()
}

export async function dropSchema(manager: ConnectionManager, ref: SchemaRef): Promise<void> {
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  if (type !== 'postgresql') {
    vscode.window.showErrorMessage('Drop schema is only supported for PostgreSQL')
    return
  }
  const confirm = await vscode.window.showWarningMessage(
    `Drop schema ${ref.schema}?\nAll objects inside (tables, views, sequences, routines) will be permanently deleted with CASCADE.`,
    { modal: true },
    'Drop'
  )
  if (confirm !== 'Drop') {
    return
  }
  const sql = `DROP SCHEMA IF EXISTS ${quoteIdentifier(ref.schema, type)} CASCADE`
  await nodeExec(manager, ref.connectionId, ref.database ?? database).execute(sql)
  vscode.window.showInformationMessage(`Dropped schema ${ref.schema}`)
  refreshTree()
}

export async function exportTable(manager: ConnectionManager, ref: TableRef): Promise<void> {
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${fileSafeName(ref.table)}.csv`),
    filters: { 'CSV files': ['csv'] },
    saveLabel: 'Export',
  })
  if (!saveUri) {
    return
  }
  const exec = nodeExec(manager, ref.connectionId, ref.database)
  const result = await exec.execute(
    `SELECT * FROM ${qualifiedName(type, ref.table, ref.database ?? database, ref.schema)}`
  )
  const csv = toCsv(result.columns, result.rows)
  fs.writeFileSync(saveUri.fsPath, csv, 'utf8')
  vscode.window.showInformationMessage(`Exported ${result.rowCount} rows to ${saveUri.fsPath}`)
}

export async function importTable(manager: ConnectionManager, ref: TableRef): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'CSV files': ['csv'] },
    openLabel: 'Import CSV',
  })
  if (!uris || uris.length === 0) {
    return
  }
  const uri = uris[0]
  const text = fs.readFileSync(uri.fsPath, 'utf8')
  const parsed = parseCsv(text)
  if (parsed.length === 0) {
    vscode.window.showErrorMessage('The CSV file is empty')
    return
  }
  const header = parsed[0].filter((col) => col.length > 0)
  if (header.length === 0) {
    vscode.window.showErrorMessage('The CSV file has no header row')
    return
  }
  const dataRows = parsed.slice(1)
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const exec = nodeExec(manager, ref.connectionId, ref.database)
  const name = qualifiedName(type, ref.table, ref.database ?? database, ref.schema)
  const columns = header.map((col) => quoteIdentifier(col, type)).join(', ')
  const marks = placeholders(type, header.length).join(', ')
  const batchSize = 100
  let imported = 0
  for (let i = 0; i < dataRows.length; i += batchSize) {
    const batch = dataRows.slice(i, i + batchSize)
    const values = batch.flatMap((row) => header.map((col, idx) => (row[idx] === '' ? null : row[idx])))
    const rowMarks = Array(batch.length).fill(`(${marks})`).join(', ')
    await exec.execute(
      `INSERT INTO ${name} (${columns}) VALUES ${rowMarks}`,
      values
    )
    imported += batch.length
  }
  vscode.window.showInformationMessage(`Imported ${imported} rows into ${ref.table}`)
  refreshTree()
}

export async function exportDatabase(manager: ConnectionManager, ref: SchemaRef): Promise<void> {
  const folderUri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose export folder',
  })
  if (!folderUri || folderUri.length === 0) {
    return
  }
  const folder = folderUri[0].fsPath
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const exec = nodeExec(manager, ref.connectionId, ref.database ?? database)
  const objects = await exec.driver().getSchemaObjects(ref.database ?? database, ref.schema)
  const tables = objects.filter((o) => o.type === 'table' || o.type === 'view')
  if (tables.length === 0) {
    vscode.window.showWarningMessage('No tables found to export')
    return
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting ${ref.schema}…` },
    async () => {
      for (const table of tables) {
        const result = await exec.execute(
          `SELECT * FROM ${qualifiedName(type, table.name, ref.database ?? database, ref.schema)}`
        )
        const filename = `${fileSafeName(ref.schema)}_${fileSafeName(table.name)}.csv`
        fs.writeFileSync(path.join(folder, filename), toCsv(result.columns, result.rows), 'utf8')
      }
    }
  )
  vscode.window.showInformationMessage(`Exported ${tables.length} tables to ${folder}`)
}

export async function importDatabase(manager: ConnectionManager, ref: SchemaRef): Promise<void> {
  const folderUri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose folder with CSV files',
  })
  if (!folderUri || folderUri.length === 0) {
    return
  }
  const folder = folderUri[0].fsPath
  const files = fs
    .readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
  if (files.length === 0) {
    vscode.window.showWarningMessage('No CSV files found in the selected folder')
    return
  }
  const { type, database } = await ensureConnection(manager, ref.connectionId)
  const exec = nodeExec(manager, ref.connectionId, ref.database ?? database)
  const confirm = await vscode.window.showWarningMessage(
    `Import ${files.length} CSV file(s) into schema ${ref.schema}?`,
    { modal: true },
    'Import'
  )
  if (confirm !== 'Import') {
    return
  }
  let importedFiles = 0
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Importing ${ref.schema}…` },
    async () => {
      for (const file of files) {
        const tableName = path.basename(file, path.extname(file))
        const parsed = parseCsv(fs.readFileSync(path.join(folder, file), 'utf8'))
        if (parsed.length === 0) {
          continue
        }
        const header = parsed[0].filter((col) => col.length > 0)
        if (header.length === 0) {
          continue
        }
        const dataRows = parsed.slice(1)
        const name = qualifiedName(type, tableName, ref.database ?? database, ref.schema)
        const columns = header.map((col) => quoteIdentifier(col, type)).join(', ')
        const marks = placeholders(type, header.length).join(', ')
        for (let i = 0; i < dataRows.length; i += 100) {
          const batch = dataRows.slice(i, i + 100)
          const values = batch.flatMap((row) => header.map((col, idx) => (row[idx] === '' ? null : row[idx])))
          const rowMarks = Array(batch.length).fill(`(${marks})`).join(', ')
          await exec.execute(`INSERT INTO ${name} (${columns}) VALUES ${rowMarks}`, values)
        }
        importedFiles += 1
      }
    }
  )
  vscode.window.showInformationMessage(`Imported ${importedFiles} file(s) into ${ref.schema}`)
  refreshTree()
}
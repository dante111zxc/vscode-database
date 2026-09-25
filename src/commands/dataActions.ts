import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConnectionManager } from '../database/ConnectionManager'
import type { QueryResult } from '../database/types'
import type { DatabaseDriver } from '../database/contracts/DatabaseDriver'
import { toCsv } from '../utils/csv'
import {
  renderTable,
  renderSingleWorkbook,
  renderDatabase,
  renderWorkbook,
  parseTableImport,
  parseDatabaseImport,
  splitSqlStatements,
  TRANSFER_EXTENSIONS,
} from '../utils/transferFormats'
import type { TransferFormat, ExportTableData, ExportDbTable } from '../utils/transferFormats'
import {
  pgDump,
  pgRestore,
  mysqlDump,
  mysqlImport,
  psqlImport,
  nativeTargetFromConfig,
  type TransferOutput,
} from '../utils/nativeTransfer'
import { log as logLine, showTransferOutput } from '../utils/outputChannel'

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

export interface DatabaseRef {
  connectionId: string
  database: string
}

export interface DatabaseTransferRef extends DatabaseRef {
  schema?: string
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

type TransferReport = (message: string) => void

function runTransfer<T>(
  title: string,
  action: (report: TransferReport, token: vscode.CancellationToken) => Promise<T>
): Promise<T> {
  showTransferOutput(true)
  logLine('---', title, 'started')
  return Promise.resolve(
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      (progress, token) =>
        action(
          (message: string) => {
            logLine(message)
            progress.report({ message })
          },
          token
        )
    )
  ).then(
      (result: T) => {
        logLine('---', title, 'finished')
        return result
      },
      (error: unknown) => {
        logLine('---', title, 'FAILED:', error)
        throw error
      }
    )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportToolOutput(report: TransferReport): TransferOutput {
  return (line: string) => {
    const trimmed = line.trimEnd()
    if (trimmed) {
      report(trimmed)
    }
  }
}

async function ensurePostgresDatabaseExists(
  manager: ConnectionManager,
  ref: { connectionId: string },
  config: { database?: string },
  targetDb: string,
  report: TransferReport
): Promise<void> {
  const systemDb = config.database && config.database !== targetDb ? config.database : 'template1'
  const sysExec = nodeExec(manager, ref.connectionId, systemDb)
  const exists = await sysExec.execute('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb])
  if (exists.rows.length === 0) {
    report(`Target database "${targetDb}" does not exist, creating it…`)
    await sysExec.execute(`CREATE DATABASE ${quoteIdentifier(targetDb, 'postgresql')}`)
    report(`Created database "${targetDb}"`)
  }
}

function truncateSql(sql: string, max: number): string {
  return sql.length > max ? `${sql.slice(0, max)}…` : sql
}

async function executeSqlStatements(
  filePath: string,
  exec: ReturnType<typeof nodeExec>,
  report: TransferReport
): Promise<number> {
  const text = fs.readFileSync(filePath, 'utf8')
  const statements = splitSqlStatements(text)
  const total = statements.length
  if (total === 0) {
    vscode.window.showWarningMessage('No SQL statements found in the file')
    return 0
  }
  report(`Executing ${total} SQL statement(s) from ${path.basename(filePath)}`)
  for (let i = 0; i < total; i += 1) {
    const statement = statements[i]
    try {
      await exec.execute(statement)
    } catch (error) {
      logLine(`Statement ${i + 1}/${total} FAILED:`)
      logLine(statement)
      throw new Error(
        `SQL statement ${i + 1}/${total} failed:\n${truncateSql(statement, 500)}\nError: ${messageOf(error)}`
      )
    }
    if ((i + 1) % 20 === 0 || i + 1 === total) {
      report(`Executed ${i + 1}/${total} statement(s)`)
    }
  }
  report(`Executed all ${total} statement(s) successfully`)
  return total
}

export async function createDatabase(
  manager: ConnectionManager,
  connectionId: string
): Promise<void> {
  const { type } = await ensureConnection(manager, connectionId)
  if (type === 'sqlite') {
    vscode.window.showErrorMessage('Create database is not supported for SQLite')
    return
  }
  const name = await vscode.window.showInputBox({
    prompt: 'Enter the name for the new database',
    validateInput: (value) => (value.trim() ? undefined : 'Database name cannot be empty'),
  })
  if (!name || !name.trim()) {
    return
  }
  const database = name.trim()
  const sql = `CREATE DATABASE ${quoteIdentifier(database, type)}`
  await nodeExec(manager, connectionId, undefined).execute(sql)
  vscode.window.showInformationMessage(`Created database ${database}`)
  refreshTree()
}

export async function dropDatabase(manager: ConnectionManager, ref: DatabaseRef): Promise<void> {
  const { type } = await ensureConnection(manager, ref.connectionId)
  if (type === 'sqlite') {
    vscode.window.showErrorMessage('Drop database is not supported for SQLite')
    return
  }
  const confirm = await vscode.window.showWarningMessage(
    `Drop database ${ref.database}?\nAll data inside will be permanently deleted.`,
    { modal: true },
    'Drop'
  )
  if (confirm !== 'Drop') {
    return
  }
  if (type === 'postgresql') {
    await dropPostgresDatabase(manager, ref)
    return
  }
  const sql = `DROP DATABASE IF EXISTS ${quoteIdentifier(ref.database, type)}`
  await nodeExec(manager, ref.connectionId, ref.database).execute(sql)
  vscode.window.showInformationMessage(`Dropped database ${ref.database}`)
  refreshTree()
}

async function dropPostgresDatabase(
  manager: ConnectionManager,
  ref: DatabaseRef
): Promise<void> {
  const config = manager.getActiveConfig(ref.connectionId)
  const systemDb =
    config?.database && config.database !== ref.database ? config.database : 'postgres'
  const exec = nodeExec(manager, ref.connectionId, systemDb)
  const sql = `DROP DATABASE IF EXISTS ${quoteIdentifier(ref.database, 'postgresql')}`
  await exec.execute(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity ' +
      'WHERE datname = $1 AND pid <> pg_backend_pid()',
    [ref.database]
  )
  for (let attempt = 0; ; attempt++) {
    try {
      await exec.execute(sql)
      break
    } catch (error) {
      if (attempt >= 2) {
        throw error
      }
      await exec.execute(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity ' +
          'WHERE datname = $1 AND pid <> pg_backend_pid()',
        [ref.database]
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  vscode.window.showInformationMessage(`Dropped database ${ref.database}`)
  refreshTree()
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
  return runTransfer(`Export table ${ref.table}`, async (report) => {
    const { type, database } = await ensureConnection(manager, ref.connectionId)
    report(`Connected to connection ${ref.connectionId} (${type})`)
    const format = await pickFormat('export', type)
    if (!format) {
      return
    }
    report(`Format: ${format}`)
    const dbName = ref.database ?? database
    if (format === 'dump' || format === 'tar') {
      await exportTableNative(manager, ref, type, dbName, format, report)
      return
    }
    report(`Reading data from ${dbName ?? ''}${ref.schema ? `.${ref.schema}` : ''}.${ref.table}…`)
    const exec = nodeExec(manager, ref.connectionId, dbName)
    const result = await exec.execute(
      `SELECT * FROM ${qualifiedName(type, ref.table, dbName, ref.schema)}`
    )
    report(`Fetched ${result.rowCount} rows`)
    const data: ExportTableData = {
      type,
      database: dbName,
      schema: ref.schema,
      table: ref.table,
      columns: result.columns,
      rows: result.rows,
    }
    const buffer =
      format === 'xlsx' ? await renderSingleWorkbook(data) : renderTable(format, data)
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${fileSafeName(ref.table)}.${TRANSFER_EXTENSIONS[format]}`),
      filters: { [`${format.toUpperCase()} files`]: [TRANSFER_EXTENSIONS[format]] },
      saveLabel: 'Export',
    })
    if (!saveUri) {
      return
    }
    fs.writeFileSync(saveUri.fsPath, buffer)
    report(`Saved ${result.rowCount} rows to ${saveUri.fsPath}`)
    vscode.window.showInformationMessage(`Exported ${result.rowCount} rows to ${saveUri.fsPath}`)
  })
}

export async function importTable(manager: ConnectionManager, ref: TableRef): Promise<void> {
  return runTransfer(`Import table ${ref.table}`, async (report) => {
    const { type } = await ensureConnection(manager, ref.connectionId)
    report(`Connected to connection ${ref.connectionId} (${type})`)
    const format = await pickFormat('import', type)
    if (!format) {
      return
    }
    report(`Format: ${format}`)
    const dbName = ref.database
    const exec = nodeExec(manager, ref.connectionId, dbName)
    if (format === 'dump' || format === 'tar') {
      await importTableNative(manager, ref, type, dbName, report)
      return
    }
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: IMPORT_FILE_FILTERS,
      openLabel: 'Import',
    })
    if (!uris || uris.length === 0) {
      return
    }
    const uri = uris[0]
    if (format === 'sql') {
      await executeSqlStatements(uri.fsPath, exec, report)
      refreshTree()
      return
    }
    report(`Parsing ${path.basename(uri.fsPath)}…`)
    const tableData = await parseTableImport(format, fs.readFileSync(uri.fsPath), uri.fsPath)
    if (tableData.columns.length === 0) {
      vscode.window.showErrorMessage('The file has no column headers to import')
      return
    }
    report(`File has ${tableData.rows.length} rows in ${tableData.columns.length} column(s)`)
    const imported = await insertRows(exec, type, ref.table, dbName, ref.schema, tableData.columns, tableData.rows)
    report(`Inserted ${imported} row(s) into ${ref.table}`)
    vscode.window.showInformationMessage(`Imported ${imported} rows into ${ref.table}`)
    refreshTree()
  })
}

export async function exportDatabase(
  manager: ConnectionManager,
  ref: DatabaseTransferRef
): Promise<void> {
  return runTransfer(`Export database ${ref.schema ?? ref.database ?? ''}`, async (report) => {
    const { type, database } = await ensureConnection(manager, ref.connectionId)
    report(`Connected to connection ${ref.connectionId} (${type})`)
    const format = await pickFormat('export', type)
    if (!format) {
      return
    }
    report(`Format: ${format}`)
    const dbName = ref.database ?? database
    if (format === 'dump' || format === 'tar') {
      await exportDatabaseNative(manager, ref, type, dbName, format, report)
      return
    }
    report(`Enumerating tables of ${ref.schema ?? dbName}…`)
    const exec = nodeExec(manager, ref.connectionId, dbName)
    const tables = await collectTransferTables(exec.driver(), type, dbName, ref.schema)
    if (tables.length === 0) {
      vscode.window.showWarningMessage('No tables found to export')
      return
    }
    report(`Found ${tables.length} table(s)`)
    if (format === 'csv') {
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Choose export folder',
      })
      if (!folderUri || folderUri.length === 0) {
        return
      }
      const folder = folderUri[0].fsPath
      for (const table of tables) {
        const result = await exec.execute(
          `SELECT * FROM ${qualifiedName(type, table.name, dbName, table.schema ?? ref.schema)}`
        )
        const scope = ref.schema ?? table.schema ?? dbName ?? 'database'
        const filename = `${fileSafeName(scope)}_${fileSafeName(table.name)}.csv`
        fs.writeFileSync(path.join(folder, filename), Buffer.from(toCsv(result.columns, result.rows), 'utf8'))
        report(`Exported ${result.rowCount} row(s) to ${filename}`)
      }
      vscode.window.showInformationMessage(`Exported ${tables.length} tables to ${folder}`)
      return
    }
    const exportTables: ExportDbTable[] = []
    for (const table of tables) {
      const result = await exec.execute(
        `SELECT * FROM ${qualifiedName(type, table.name, dbName, table.schema ?? ref.schema)}`
      )
      exportTables.push({
        name: table.name,
        schema: table.schema ?? ref.schema,
        columns: result.columns,
        rows: result.rows,
      })
      report(`Fetched ${result.rowCount} row(s) from ${table.schema ?? dbName}.${table.name}`)
    }
    let buffer: Buffer
    if (format === 'xlsx') {
      buffer = await renderWorkbook(exportTables)
    } else if (format === 'sql' || format === 'json' || format === 'xml') {
      buffer = renderDatabase(format, type, dbName, exportTables)
    } else {
      return
    }
    report(`Rendered ${format.toUpperCase()} output (${exportTables.length} table(s))`)
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${fileSafeName(ref.schema ?? dbName)}.${TRANSFER_EXTENSIONS[format]}`),
      filters: { [`${format.toUpperCase()} files`]: [TRANSFER_EXTENSIONS[format]] },
      saveLabel: 'Export',
    })
    if (!saveUri) {
      return
    }
    fs.writeFileSync(saveUri.fsPath, buffer)
    report(`Saved ${exportTables.length} table(s) to ${saveUri.fsPath}`)
    vscode.window.showInformationMessage(`Exported ${exportTables.length} tables to ${saveUri.fsPath}`)
  })
}

export async function importDatabase(
  manager: ConnectionManager,
  ref: DatabaseTransferRef
): Promise<void> {
  return runTransfer(`Import database ${ref.schema ?? ref.database ?? ''}`, async (report) => {
    const { type, database } = await ensureConnection(manager, ref.connectionId)
    report(`Connected to connection ${ref.connectionId} (${type})`)
    const format = await pickFormat('import', type)
    if (!format) {
      return
    }
    report(`Format: ${format}`)
    const dbName = ref.database ?? database
    const exec = nodeExec(manager, ref.connectionId, dbName)
    const target = ref.schema ?? dbName
    if (format === 'dump' || format === 'tar') {
      await importDatabaseNative(manager, ref, type, dbName, report)
      return
    }
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: IMPORT_FILE_FILTERS,
      openLabel: 'Import',
    })
    if (!uris || uris.length === 0) {
      return
    }
    const uri = uris[0]
    if (format === 'sql') {
      await importSqlFile(manager, ref, type, exec, uri.fsPath, dbName, target, report)
      refreshTree()
      return
    }
    if (format === 'csv') {
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
      const confirm = await vscode.window.showWarningMessage(
        `Import ${files.length} CSV file(s) into ${target}?`,
        { modal: true },
        'Import'
      )
      if (confirm !== 'Import') {
        return
      }
      report(`Importing ${files.length} CSV file(s) from ${folder}`)
      let importedFiles = 0
      for (const file of files) {
        const tableName = path.basename(file, path.extname(file))
        const tableData = await parseTableImport('csv', fs.readFileSync(path.join(folder, file)))
        if (tableData.columns.length === 0) {
          report(`Skipped ${file}: no column headers`)
          continue
        }
        const imported = await insertRows(
          exec,
          type,
          tableName,
          dbName,
          ref.schema,
          tableData.columns,
          tableData.rows
        )
        report(`Inserted ${imported} row(s) from ${file}`)
        if (imported > 0) {
          importedFiles += 1
        }
      }
      vscode.window.showInformationMessage(`Imported ${importedFiles} file(s) into ${target}`)
      refreshTree()
      return
    }
    report(`Parsing ${path.basename(uri.fsPath)}…`)
    const tables = await parseDatabaseImport(format, fs.readFileSync(uri.fsPath), uri.fsPath)
    if (tables.length === 0) {
      vscode.window.showWarningMessage('No tables found in the file')
      return
    }
    const confirm = await vscode.window.showWarningMessage(
      `Import ${tables.length} table(s) from ${path.basename(uri.fsPath)} into ${target}?`,
      { modal: true },
      'Import'
    )
    if (confirm !== 'Import') {
      return
    }
    report(`Importing ${tables.length} table(s) into ${target}`)
    let imported = 0
    for (const table of tables) {
      const tableName = table.name || path.basename(uri.fsPath, path.extname(uri.fsPath))
      const inserted = await insertRows(
        exec,
        type,
        tableName,
        dbName,
        table.schema ?? ref.schema,
        table.columns,
        table.rows
      )
      imported += inserted
      report(`Inserted ${inserted} row(s) into ${tableName}`)
    }
    vscode.window.showInformationMessage(`Imported ${imported} rows from ${path.basename(uri.fsPath)}`)
    refreshTree()
  })
}

async function importSqlFile(
  manager: ConnectionManager,
  ref: DatabaseTransferRef,
  type: string,
  exec: ReturnType<typeof nodeExec>,
  filePath: string,
  dbName: string | undefined,
  target: string,
  report: TransferReport
): Promise<void> {
  const config = await manager.getConnectionWithSecret(ref.connectionId)
  if (!config) {
    return
  }
  const targetDb = (dbName ?? target)?.trim()
  if (!targetDb) {
    vscode.window.showErrorMessage('No target database specified for the SQL import')
    return
  }
  if (type === 'postgresql') {
    await ensurePostgresDatabaseExists(manager, ref, config, targetDb, report)
    report(`Importing SQL via psql into "${targetDb}"…`)
    const status = await psqlImport(
      nativeTargetFromConfig(config, targetDb),
      filePath,
      reportToolOutput(report)
    )
    if (status === 'ok') {
      report(`psql import into "${targetDb}" completed`)
      return
    }
    report('psql not found in PATH — falling back to in-app statement execution')
  } else if (type === 'mysql' || type === 'mariadb') {
    report(`Importing SQL via mysql client into "${targetDb}"…`)
    const status = await mysqlImport(
      nativeTargetFromConfig(config, targetDb),
      filePath,
      reportToolOutput(report)
    )
    if (status === 'ok') {
      report(`mysql import into "${targetDb}" completed`)
      return
    }
    report('mysql client not found in PATH — falling back to in-app statement execution')
  }
  await executeSqlStatements(filePath, exec, report)
}

async function exportTableNative(
  manager: ConnectionManager,
  ref: TableRef,
  type: string,
  dbName: string | undefined,
  format: 'dump' | 'tar',
  report: TransferReport
): Promise<void> {
  const config = await manager.getConnectionWithSecret(ref.connectionId)
  if (!config) {
    return
  }
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${fileSafeName(ref.table)}.${TRANSFER_EXTENSIONS[format]}`),
    filters: { [`${format.toUpperCase()} files`]: [TRANSFER_EXTENSIONS[format]] },
    saveLabel: 'Export',
  })
  if (!saveUri) {
    return
  }
  const target = nativeTargetFromConfig(config, dbName || config.database || '')
  report(`Running pg_dump/mysqldump for table ${ref.table}…`)
  if (type === 'postgresql') {
    const tableArg = ref.schema ? { schema: ref.schema, name: ref.table } : undefined
    await pgDump(target, saveUri.fsPath, format === 'tar' ? 'tar' : 'custom', tableArg, undefined, reportToolOutput(report))
  } else {
    await mysqlDump(target, saveUri.fsPath, ref.table, reportToolOutput(report))
  }
  report(`Saved to ${saveUri.fsPath}`)
  vscode.window.showInformationMessage(`Exported to ${saveUri.fsPath}`)
}

async function exportDatabaseNative(
  manager: ConnectionManager,
  ref: DatabaseTransferRef,
  type: string,
  dbName: string | undefined,
  format: 'dump' | 'tar',
  report: TransferReport
): Promise<void> {
  const config = await manager.getConnectionWithSecret(ref.connectionId)
  if (!config) {
    return
  }
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      `${fileSafeName(ref.schema ?? dbName ?? 'database')}.${TRANSFER_EXTENSIONS[format]}`
    ),
    filters: { [`${format.toUpperCase()} files`]: [TRANSFER_EXTENSIONS[format]] },
    saveLabel: 'Export',
  })
  if (!saveUri) {
    return
  }
  const target = nativeTargetFromConfig(config, dbName || config.database || '')
  report(`Running ${type === 'postgresql' ? 'pg_dump' : 'mysqldump'} for ${ref.schema ?? dbName ?? ''}…`)
  if (type === 'postgresql') {
    await pgDump(target, saveUri.fsPath, format === 'tar' ? 'tar' : 'custom', undefined, ref.schema, reportToolOutput(report))
  } else {
    await mysqlDump(target, saveUri.fsPath, undefined, reportToolOutput(report))
  }
  report(`Saved to ${saveUri.fsPath}`)
  vscode.window.showInformationMessage(`Exported to ${saveUri.fsPath}`)
}

async function importTableNative(
  manager: ConnectionManager,
  ref: TableRef,
  type: string,
  dbName: string | undefined,
  report: TransferReport
): Promise<void> {
  const config = await manager.getConnectionWithSecret(ref.connectionId)
  if (!config) {
    return
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Database dump': ['dump', 'tar'] },
    openLabel: 'Import',
  })
  if (!uris || uris.length === 0) {
    return
  }
  const uri = uris[0]
  const target = nativeTargetFromConfig(config, dbName || config.database || '')
  if (type === 'postgresql') {
    const tableArg = ref.schema ? { schema: ref.schema, name: ref.table } : undefined
    report(`Running pg_restore for table ${ref.table}…`)
    await pgRestore(target, uri.fsPath, tableArg, reportToolOutput(report))
    report(`Restored table ${ref.table}`)
  } else {
    report('Running mysql import…')
    const status = await mysqlImport(target, uri.fsPath, reportToolOutput(report))
    if (status === 'missing') {
      throw new Error('The "mysql" tool was not found in PATH — cannot restore a dump without it. Install it and try again.')
    }
    report('Dump imported')
  }
  vscode.window.showInformationMessage(`Restored into ${dbName ?? config.database ?? 'database'}`)
  refreshTree()
}

async function importDatabaseNative(
  manager: ConnectionManager,
  ref: DatabaseTransferRef,
  type: string,
  dbName: string | undefined,
  report: TransferReport
): Promise<void> {
  const config = await manager.getConnectionWithSecret(ref.connectionId)
  if (!config) {
    return
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Database dump': ['dump', 'tar'] },
    openLabel: 'Import',
  })
  if (!uris || uris.length === 0) {
    return
  }
  const uri = uris[0]
  const defaultDb = dbName || config.database || (type === 'postgresql' ? 'postgres' : '')
  const targetDb = await vscode.window.showInputBox({
    title: 'Restore target database',
    value: defaultDb,
    prompt: 'Name of the database the dump will be restored into',
    validateInput: (value) => (value.trim() ? undefined : 'Database name cannot be empty'),
  })
  if (!targetDb || !targetDb.trim()) {
    return
  }
  const resolved = targetDb.trim()
  if (type === 'postgresql') {
    await ensurePostgresDatabaseExists(manager, ref, config, resolved, report)
    report(`Running pg_restore into "${resolved}"…`)
    await pgRestore(nativeTargetFromConfig(config, resolved), uri.fsPath, undefined, reportToolOutput(report))
    report(`Restored into "${resolved}"`)
  } else {
    report(`Running mysql import into "${resolved}"…`)
    const status = await mysqlImport(nativeTargetFromConfig(config, resolved), uri.fsPath, reportToolOutput(report))
    if (status === 'missing') {
      throw new Error('The "mysql" tool was not found in PATH — cannot restore a dump without it. Install it and try again.')
    }
    report(`Imported into "${resolved}"`)
  }
  vscode.window.showInformationMessage(`Restored into ${resolved}`)
  refreshTree()
}

interface FormatChoice {
  format: TransferFormat
  label: string
  description: string
}

function formatChoices(kind: 'export' | 'import', type: string): FormatChoice[] {
  const choices: FormatChoice[] = [
    { format: 'csv', label: 'CSV', description: 'Comma separated values' },
    { format: 'sql', label: 'SQL', description: 'SQL script / INSERT statements' },
    { format: 'json', label: 'JSON', description: 'JSON records' },
    { format: 'xml', label: 'XML', description: 'XML records' },
    { format: 'xlsx', label: 'XLSX', description: 'Excel workbook' },
  ]
  if (type === 'postgresql') {
    choices.push(
      { format: 'dump', label: 'PostgreSQL dump (.dump)', description: 'pg_dump custom format' },
      { format: 'tar', label: 'Tar archive (.tar)', description: 'pg_dump tar format' }
    )
  } else if (type === 'mysql' || type === 'mariadb') {
    choices.push({ format: 'dump', label: 'MySQL dump (.dump)', description: 'mysqldump output' })
  } else {
    void kind
  }
  return choices
}

async function pickFormat(
  kind: 'export' | 'import',
  type: string
): Promise<TransferFormat | undefined> {
  const items = formatChoices(kind, type).map(
    (choice) =>
      ({
        label: choice.label,
        description: choice.description,
        data: choice.format,
      }) as vscode.QuickPickItem & { data: TransferFormat }
  )
  const picked = await vscode.window.showQuickPick(items, {
    title: kind === 'export' ? 'Export format' : 'Import format',
    placeHolder: 'Choose a format',
  })
  return picked?.data
}

const IMPORT_FILE_FILTERS: Record<string, string[]> = {
  'All supported files': ['csv', 'sql', 'json', 'xml', 'xlsx', 'dump', 'tar'],
  CSV: ['csv'],
  SQL: ['sql'],
  JSON: ['json'],
  XML: ['xml'],
  Excel: ['xlsx'],
  'Database dump': ['dump', 'tar'],
}

async function insertRows(
  exec: ReturnType<typeof nodeExec>,
  type: string,
  table: string,
  database: string | undefined,
  schema: string | undefined,
  columns: string[],
  rows: unknown[][]
): Promise<number> {
  if (rows.length === 0 || columns.length === 0) {
    return 0
  }
  const name = qualifiedName(type, table, database, schema)
  const colList = columns.map((c) => quoteIdentifier(c, type)).join(', ')
  const marks = placeholders(type, columns.length).join(', ')
  let inserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const values = batch.flatMap((row) => columns.map((c, idx) => (row[idx] === '' ? null : row[idx])))
    const rowMarks = Array(batch.length).fill(`(${marks})`).join(', ')
    await exec.execute(`INSERT INTO ${name} (${colList}) VALUES ${rowMarks}`, values)
    inserted += batch.length
  }
  return inserted
}

interface TransferTable {
  name: string
  type: 'table' | 'view'
  schema?: string
}

async function collectTransferTables(
  driver: DatabaseDriver,
  type: string,
  database: string,
  schema?: string
): Promise<TransferTable[]> {
  if (type === 'postgresql' && !schema) {
    const tables = await driver.getTables(database)
    return tables.map((table) => ({ name: table.name, type: table.type, schema: table.schema }))
  }
  const objects = await driver.getSchemaObjects(database, schema)
  return objects
    .filter((o) => o.type === 'table' || o.type === 'view')
    .map((o) => ({ name: o.name, type: o.type as 'table' | 'view', schema }))
}
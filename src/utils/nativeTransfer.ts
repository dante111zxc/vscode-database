import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import { promisify } from 'node:util'
import type { ConnectionConfig } from '../database/types'

const execFileAsync = promisify(execFile)

export interface NativeTarget {
  host: string
  port: number
  username: string
  password: string
  database: string
}

export type TransferOutput = (line: string) => void

export function nativeTargetFromConfig(
  config: ConnectionConfig,
  database: string
): NativeTarget {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password ?? '',
    database,
  }
}

function pgEnv(target: NativeTarget): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (target.password) {
    env.PGPASSWORD = target.password
  }
  return env
}

function pgBaseArgs(target: NativeTarget): string[] {
  return [
    '--host',
    target.host,
    '--port',
    String(target.port),
    '--username',
    target.username,
    '--no-password',
  ]
}

export async function pgDump(
  target: NativeTarget,
  outputFile: string,
  format: 'custom' | 'tar',
  table?: { schema: string; name: string },
  schema?: string,
  onOutput?: TransferOutput
): Promise<void> {
  const args = [
    ...pgBaseArgs(target),
    '--dbname',
    target.database,
    '--format',
    format,
    '--file',
    outputFile,
  ]
  if (schema) {
    args.push('--schema', schema)
  }
  if (table) {
    args.push('--table', `${table.schema}.${table.name}`)
  }
  await runTool('pg_dump', args, pgEnv(target), onOutput)
}

export async function pgRestore(
  target: NativeTarget,
  inputFile: string,
  table?: { schema: string; name: string },
  onOutput?: TransferOutput
): Promise<void> {
  const args = [
    ...pgBaseArgs(target),
    '--dbname',
    target.database,
    '--clean',
    '--if-exists',
    '--no-owner',
  ]
  if (table) {
    args.push('--table', `${table.schema}.${table.name}`)
  }
  args.push(inputFile)
  await runTool('pg_restore', args, pgEnv(target), onOutput)
}

function mysqlBaseArgs(target: NativeTarget): string[] {
  return [
    '--host',
    target.host,
    '--port',
    String(target.port),
    '--user',
    target.username,
    `--password=${target.password}`,
    '--default-character-set=utf8mb4',
  ]
}

export async function mysqlDump(
  target: NativeTarget,
  outputFile: string,
  table?: string,
  onOutput?: TransferOutput
): Promise<void> {
  const args = [
    ...mysqlBaseArgs(target),
    '--routines',
    '--triggers',
    '--result-file',
    outputFile,
    target.database,
  ]
  if (table) {
    args.push(table)
  }
  await runTool('mysqldump', args, process.env, onOutput)
}

export async function mysqlImport(
  target: NativeTarget,
  inputFile: string,
  onOutput?: TransferOutput
): Promise<'ok' | 'missing'> {
  const args = [...mysqlBaseArgs(target), target.database]
  return spawnImport('mysql', args, inputFile, process.env, onOutput)
}

export async function psqlImport(
  target: NativeTarget,
  inputFile: string,
  onOutput?: TransferOutput
): Promise<'ok' | 'missing'> {
  const args = [
    ...pgBaseArgs(target),
    '--dbname',
    target.database,
    '--no-psqlrc',
    '--echo-errors',
    '--file',
    inputFile,
  ]
  return spawnImport('psql', args, inputFile, pgEnv(target), onOutput)
}

function spawnImport(
  tool: string,
  args: string[],
  inputFile: string,
  env: NodeJS.ProcessEnv,
  onOutput?: TransferOutput
): Promise<'ok' | 'missing'> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env })
    let combined = ''
    let missing = false
    const streamLine = (chunk: Buffer | string): void => {
      const text = String(chunk)
      combined += text
      if (onOutput) {
        onOutput(text)
      }
    }
    child.stdout.on('data', streamLine)
    child.stderr.on('data', streamLine)
    child.on('error', (error: Error & { code?: string }) => {
      if (error.code === 'ENOENT') {
        missing = true
        resolve('missing')
        return
      }
      reject(new Error(`"${tool}" failed: ${error.message}`))
    })
    child.on('close', (code) => {
      if (missing) {
        return
      }
      if (code === 0) {
        resolve('ok')
      } else {
        reject(new Error(`"${tool}" failed (exit ${code}): ${combined.trim()}`))
      }
    })
    child.stdin.on('error', () => undefined)
    fs.createReadStream(inputFile).pipe(child.stdin)
  })
}

async function runTool(
  tool: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onOutput?: TransferOutput
): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(tool, args, {
      env,
      maxBuffer: 128 * 1024 * 1024,
    })
    const output = [stdout, stderr].filter(Boolean).join('').trim()
    if (output && onOutput) {
      onOutput(output)
    }
  } catch (error) {
    const err = error as { code?: string; message?: string; stderr?: string; stdout?: string }
    if (err.code === 'ENOENT') {
      throw new Error(`The "${tool}" tool was not found in PATH. Install it and try again.`)
    }
    const detail = err.stderr || err.stdout || err.message || 'unknown error'
    throw new Error(`"${tool}" failed: ${String(detail).trim()}`)
  }
}
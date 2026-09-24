import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, ConnectionTestResult, SavedConnectionConfig } from './types'
import type { DatabaseDriver } from './contracts/DatabaseDriver'
import { createDriver } from './drivers'

const STORAGE_KEY = 'databaseManager.connections'

interface ActiveConnection {
  config: ConnectionConfig
  driver: DatabaseDriver
}

export class ConnectionManager {
  private readonly activeConnections = new Map<string, ActiveConnection>()

  private readonly onDidChangeConnectionsEmitter = new vscode.EventEmitter<void>()

  private readonly onDidChangeConnectionStatusEmitter = new vscode.EventEmitter<string>()

  public readonly onDidChangeConnections = this.onDidChangeConnectionsEmitter.event

  public readonly onDidChangeConnectionStatus = this.onDidChangeConnectionStatusEmitter.event

  constructor(
    private readonly context: vscode.ExtensionContext
  ) {}

  public async getConnections(): Promise<SavedConnectionConfig[]> {
    return this.context.globalState.get<SavedConnectionConfig[]>(STORAGE_KEY) ?? []
  }

  public async getConnection(id: string): Promise<SavedConnectionConfig | undefined> {
    const all = await this.getConnections()
    return all.find((c) => c.id === id)
  }

  public async getConnectionWithSecret(id: string): Promise<ConnectionConfig | undefined> {
    const saved = await this.getConnection(id)
    if (!saved) {
      return undefined
    }
    const password = await this.readSecret(id)
    return { ...saved, password }
  }

  public async saveConnection(config: ConnectionConfig): Promise<SavedConnectionConfig> {
    const id = config.id || randomUUID()
    const existing = await this.getConnections()
    const password = config.password ?? ''

    const sanitized: SavedConnectionConfig = {
      id,
      name: config.name,
      type: config.type,
      host: config.host,
      port: config.port,
      username: config.username,
      database: config.database,
      ssl: config.ssl,
      filePath: config.filePath,
    }

    const withoutDuplicate = existing.filter((c) => c.id !== id)
    const updated = [...withoutDuplicate, sanitized]
    await this.context.globalState.update(STORAGE_KEY, updated)
    if (password) {
      await this.writeSecret(id, password)
    }
    this.onDidChangeConnectionsEmitter.fire()
    return sanitized
  }

  public async deleteConnection(id: string): Promise<void> {
    await this.disconnect(id)
    const existing = await this.getConnections()
    await this.context.globalState.update(
      STORAGE_KEY,
      existing.filter((c) => c.id !== id)
    )
    try {
      await this.context.secrets.delete(`database-manager:${id}`)
    } catch {
      // ignore secret deletion errors
    }
    this.onDidChangeConnectionsEmitter.fire()
  }

  public async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const driver = createDriver(config.type)
    try {
      await driver.testConnection(config)
      return { ok: true, message: 'Connection successful' }
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) }
    }
  }

  public async connect(id: string): Promise<void> {
    if (this.isConnected(id)) {
      return
    }
    const config = await this.getConnectionWithSecret(id)
    if (!config) {
      throw new Error('Connection not found')
    }
    const driver = createDriver(config.type)
    await driver.connect(config)
    this.activeConnections.set(id, { config, driver })
    this.onDidChangeConnectionStatusEmitter.fire(id)
  }

  public async disconnect(id: string): Promise<void> {
    const active = this.activeConnections.get(id)
    if (!active) {
      return
    }
    try {
      await active.driver.disconnect()
    } finally {
      this.activeConnections.delete(id)
      this.onDidChangeConnectionStatusEmitter.fire(id)
    }
  }

  public async disconnectAll(): Promise<void> {
    const ids = [...this.activeConnections.keys()]
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }

  public isConnected(id: string): boolean {
    return this.activeConnections.has(id)
  }

  public getDriver(id: string): DatabaseDriver | undefined {
    return this.activeConnections.get(id)?.driver
  }

  public getActiveConfig(id: string): ConnectionConfig | undefined {
    return this.activeConnections.get(id)?.config
  }

  private async readSecret(id: string): Promise<string> {
    try {
      return (await this.context.secrets.get(`database-manager:${id}`)) ?? ''
    } catch {
      return ''
    }
  }

  private async writeSecret(id: string, password: string): Promise<void> {
    await this.context.secrets.store(`database-manager:${id}`, password)
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
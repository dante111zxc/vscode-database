import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'

export interface SavedQuery {
  id: string
  connectionId: string
  database?: string
  schema?: string
  label: string
  sql: string
  savedAt: number
}

const STORAGE_KEY = 'databaseManager.savedQueries'

export class QueryStore {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()

  public readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly context: vscode.ExtensionContext
  ) {}

  public async list(): Promise<SavedQuery[]> {
    return this.context.globalState.get<SavedQuery[]>(STORAGE_KEY) ?? []
  }

  public async listForSchema(
    connectionId: string,
    database: string | undefined,
    schema: string
  ): Promise<SavedQuery[]> {
    const all = await this.list()
    const db = database ?? ''
    return all
      .filter((q) => q.connectionId === connectionId && (q.database ?? '') === db && q.schema === schema)
      .sort((a, b) => b.savedAt - a.savedAt)
  }

  public async find(id: string): Promise<SavedQuery | undefined> {
    const all = await this.list()
    return all.find((q) => q.id === id)
  }

  public async save(input: Omit<SavedQuery, 'id' | 'savedAt'>): Promise<SavedQuery> {
    const query: SavedQuery = {
      ...input,
      id: randomUUID(),
      savedAt: Date.now(),
    }
    await this.persist([...await this.list(), query])
    this.onDidChangeEmitter.fire()
    return query
  }

  public async updateSql(id: string, sql: string): Promise<void> {
    const all = await this.list()
    const next = all.map((q) => (q.id === id ? { ...q, sql, savedAt: Date.now() } : q))
    await this.persist(next)
    this.onDidChangeEmitter.fire()
  }

  public async rename(id: string, label: string): Promise<void> {
    if (!label.trim()) {
      return
    }
    const all = await this.list()
    const next = all.map((q) => (q.id === id ? { ...q, label: label.trim(), savedAt: Date.now() } : q))
    await this.persist(next)
    this.onDidChangeEmitter.fire()
  }

  public async remove(id: string): Promise<void> {
    const all = await this.list()
    await this.persist(all.filter((q) => q.id !== id))
    this.onDidChangeEmitter.fire()
  }

  private async persist(queries: SavedQuery[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, queries)
  }
}
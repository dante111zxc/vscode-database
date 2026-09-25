import * as vscode from 'vscode'
import type { ConnectionConfig } from '../database/types'
import type { ConnectionManager } from '../database/ConnectionManager'
import { getTypeLabel } from '../database/drivers'
import { buildWebviewHtml } from './webviewHtml'

interface WebviewMessage {
  type: string
  payload?: Record<string, unknown>
}

export class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'databaseManager.connections'

  private static instance: WebviewProvider | null = null

  private view: vscode.WebviewView | null = null

  private editingId: string | null = null

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: ConnectionManager
  ) {}

  public static getInstance(
    context: vscode.ExtensionContext,
    manager: ConnectionManager
  ): WebviewProvider {
    if (!WebviewProvider.instance) {
      WebviewProvider.instance = new WebviewProvider(context, manager)
      WebviewProvider.instance.subscribeToChanges()
    }
    return WebviewProvider.instance
  }

  private subscribeToChanges(): void {
    this.manager.onDidChangeConnections(() => {
      void this.postInitialData(false)
    })
    this.manager.onDidChangeConnectionStatus(() => {
      void this.postInitialData(false)
    })
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.webviewRootUri()],
    }
    webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.context, 'index.html')

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = null
      }
    })

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message)
    })

    void this.postInitialData(true)
  }

  public async open(editingId?: string): Promise<void> {
    this.editingId = editingId ?? null
    await vscode.commands.executeCommand(`${WebviewProvider.viewType}.focus`)
    const editing = this.editingId
      ? (await this.manager.getConnection(this.editingId)) ?? null
      : null
    await this.post('openForm', { editing })
    await this.postInitialData(true)
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (!this.view) {
      return
    }
    const payload = message.payload ?? {}
    switch (message.type) {
      case 'ready':
      case 'getInitialData':
        await this.postInitialData(true)
        break
      case 'saveConnection':
        await this.handleSaveConnection(payload as { config: ConnectionConfig })
        break
      case 'testConnection':
        await this.handleTestConnection(payload as { config: ConnectionConfig })
        break
      case 'connect':
        await this.handleConnect(payload as { id: string })
        break
      case 'disconnect':
        await this.handleDisconnect(payload as { id: string })
        break
      case 'deleteConnection':
        await this.handleDeleteConnection(payload as { id: string })
        break
      case 'editConnection':
        await this.handleEditConnection(payload as { id: string })
        break
      case 'pickFile':
        await this.handlePickFile()
        break
      default:
        break
    }
  }

  private async handleSaveConnection(message: { config: ConnectionConfig }): Promise<void> {
    try {
      const saved = await this.manager.saveConnection(message.config)
      this.editingId = saved.id
      await this.post('saved', { connection: saved })
      await this.postInitialData(false)
    } catch (error) {
      await this.post('error', { message: toMessage(error) })
    }
  }

  private async handleTestConnection(message: { config: ConnectionConfig }): Promise<void> {
    const result = await this.manager.testConnection(message.config)
    await this.post('testResult', result)
  }

  private async handleConnect(message: { id: string }): Promise<void> {
    try {
      await this.manager.connect(message.id)
      await this.post('connectionStatus', {
        id: message.id,
        connected: true,
        typeLabel: getTypeLabel((await this.manager.getConnection(message.id))?.type ?? 'mysql'),
      })
    } catch (error) {
      await this.post('error', { message: toMessage(error) })
    }
  }

  private async handleDisconnect(message: { id: string }): Promise<void> {
    await this.manager.disconnect(message.id)
    await this.post('connectionStatus', { id: message.id, connected: false })
  }

  private async handleDeleteConnection(message: { id: string }): Promise<void> {
    await this.manager.deleteConnection(message.id)
    await this.postInitialData(true)
  }

  private async handleEditConnection(message: { id: string }): Promise<void> {
    this.editingId = message.id
    await this.postInitialData()
  }

  private async handlePickFile(): Promise<void> {
    const options: vscode.OpenDialogOptions = {
      canSelectMany: false,
      canSelectFolders: false,
      openLabel: 'Select SQLite database',
      filters: {
        'Database files': ['sqlite', 'sqlite3', 'db', 'db3'],
        'All files': ['*'],
      },
    }
    const selected = await vscode.window.showOpenDialog(options)
    if (selected && selected.length > 0) {
      await this.post('filePicked', { path: selected[0].fsPath })
    }
  }

  private async postInitialData(resetForm = true): Promise<void> {
    const connections = await this.manager.getConnections()
    const editing = this.editingId
      ? connections.find((c) => c.id === this.editingId) ?? null
      : null
    const connectedIds = await this.manager.getLiveConnectedIds()
    await this.post('initialData', {
      connections,
      editing,
      connectedIds,
      resetForm,
    })
  }

  private async post(type: string, payload: unknown): Promise<void> {
    if (!this.view) {
      return
    }
    await this.view.webview.postMessage({ type, payload })
  }

  private webviewRootUri(): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(this.context.extensionPath), 'dist', 'webview')
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
import { defineStore } from 'pinia'

export type DatabaseType = 'mysql' | 'mariadb' | 'postgresql' | 'sqlite'

export interface SavedConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  username: string
  database?: string
  ssl?: boolean
  filePath?: string
}

export interface ConnectionConfig extends SavedConnectionConfig {
  password: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface WebviewMessage {
  type: string
  payload?: Record<string, unknown>
}

interface ConnectionState {
  connections: SavedConnectionConfig[]
  editing: SavedConnectionConfig | null
  connectedIds: string[]
  testing: boolean
  saving: boolean
  testResult: TestResult | null
  busyId: string | null
  error: string | null
  showForm: boolean
  form: ConnectionConfig
}

function emptyForm(): ConnectionConfig {
  return {
    id: '',
    name: '',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: '',
    database: '',
    ssl: false,
    filePath: '',
  }
}

const DEFAULT_PORT: Record<DatabaseType, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  sqlite: 0,
}

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null

export const useConnectionStore = defineStore('connection', {
  state: (): ConnectionState => ({
    connections: [],
    editing: null,
    connectedIds: [],
    testing: false,
    saving: false,
    testResult: null,
    busyId: null,
    error: null,
    showForm: false,
    form: emptyForm(),
  }),

  getters: {
    isConnected: (state) => (id: string) => state.connectedIds.includes(id),
    hasEditing: (state) => Boolean(state.editing),
  },

  actions: {
    vscode() {
      vscodeApi = vscodeApi ?? acquireVsCodeApi()
      return vscodeApi
    },

    post(type: string, payload?: Record<string, unknown>) {
      this.vscode().postMessage({ type, payload })
    },

    handleMessage(message: WebviewMessage) {
      const payload = message.payload ?? {}
      switch (message.type) {
        case 'initialData':
          this.applyInitialData(
            payload as {
              connections: SavedConnectionConfig[]
              editing?: SavedConnectionConfig | null
              connectedIds: string[]
              resetForm?: boolean
            }
          )
          break
        case 'saved':
          this.handleSaved(payload as { connection: SavedConnectionConfig })
          break
        case 'testResult':
          this.testing = false
          this.testResult = payload as unknown as TestResult
          break
        case 'connectionStatus':
          this.updateConnectionStatus(payload as { id: string; connected: boolean })
          break
        case 'error':
          this.busyId = null
          this.testing = false
          this.saving = false
          this.error = (payload.message as string | undefined) ?? 'Unknown error'
          break
        case 'filePicked':
          this.applyFilePicked((payload.path as string | undefined) ?? '')
          break
        case 'openForm':
          if (payload.editing) {
            this.applyEditing(payload.editing as SavedConnectionConfig)
          } else {
            this.startNew()
          }
          break
        default:
          break
      }
    },

    applyInitialData(data: {
      connections: SavedConnectionConfig[]
      editing?: SavedConnectionConfig | null
      connectedIds: string[]
      resetForm?: boolean
    }) {
      this.connections = data.connections ?? []
      this.connectedIds = data.connectedIds ?? []
      this.error = null
      this.testResult = null
      if (data.resetForm) {
        if (data.editing) {
          this.applyEditing(data.editing)
        } else if (this.editing && data.editing === null) {
          const stillExists = this.connections.some((c) => c.id === this.editing?.id)
          if (!stillExists) {
            this.editing = null
            this.showForm = false
          }
        }
      }
    },

    handleSaved(data: { connection: SavedConnectionConfig }) {
      this.saving = false
      this.error = null
      this.editing = null
      this.showForm = false
      this.testResult = null
      this.form = emptyForm()
    },

    applyEditing(editing: SavedConnectionConfig) {
      this.showForm = true
      this.editing = editing
      this.testResult = null
      this.form = {
        ...emptyForm(),
        ...editing,
        password: '',
      }
    },

    applyFilePicked(path: string) {
      if (path) {
        this.form.filePath = path
      }
    },

    startNew() {
      this.showForm = true
      this.editing = null
      this.testResult = null
      const current = this.form
      this.form = {
        ...emptyForm(),
        type: this.form.type,
        host: current.type === 'sqlite' ? 'localhost' : current.host,
        port: DEFAULT_PORT[this.form.type],
        username: current.username,
      }
    },

    closeForm() {
      this.showForm = false
      this.editing = null
      this.testResult = null
    },

    changeType(type: DatabaseType) {
      this.form.type = type
      this.form.port = DEFAULT_PORT[type]
    },

    save() {
      this.saving = true
      this.testResult = null
      this.post('saveConnection', {
        config: {
          ...this.form,
          id: this.form.id || undefined,
        },
      })
    },

    test() {
      this.testing = true
      this.testResult = null
      this.post('testConnection', {
        config: {
          ...this.form,
          id: this.form.id || undefined,
        },
      })
    },

    pickFile() {
      this.post('pickFile', {})
    },

    connect(id: string) {
      this.busyId = id
      this.post('connect', { id })
    },

    disconnect(id: string) {
      this.busyId = id
      this.post('disconnect', { id })
    },

    remove(id: string) {
      this.busyId = id
      this.post('deleteConnection', { id })
    },

    edit(id: string) {
      const connection = this.connections.find((c) => c.id === id)
      if (connection) {
        this.applyEditing(connection)
      }
    },

    updateConnectionStatus(status: { id: string; connected: boolean }) {
      this.busyId = null
      if (status.connected && !this.connectedIds.includes(status.id)) {
        this.connectedIds.push(status.id)
      } else if (!status.connected) {
        this.connectedIds = this.connectedIds.filter((id) => id !== status.id)
      }
    },
  },
})
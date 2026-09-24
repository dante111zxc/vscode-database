declare module '*.css'
declare module '*.scss'
declare module '*.sass'

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void
  getState: () => unknown
  setState: (state: unknown) => void
}
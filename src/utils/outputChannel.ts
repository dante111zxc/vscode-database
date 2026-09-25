import * as vscode from 'vscode'

export const outputChannel = vscode.window.createOutputChannel('Database Manager')

function formatPart(part: unknown): string {
  if (part instanceof Error) {
    return `Error: ${part.message}${part.stack ? `\n${part.stack}` : ''}`
  }
  return String(part)
}

export function log(...parts: Array<unknown>): void {
  const timestamp = new Date().toLocaleTimeString()
  outputChannel.appendLine(`[${timestamp}] ${parts.map(formatPart).join(' ')}`)
}

export function logError(error: unknown, context?: string): void {
  log(context ? `${context} — ${formatPart(error)}` : formatPart(error))
}

export function showTransferOutput(preserveFocus: boolean = true): void {
  outputChannel.show(preserveFocus)
}
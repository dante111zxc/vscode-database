import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

export function buildWebviewHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  entry: string
): string {
  let html = fs.readFileSync(path.join(context.extensionPath, 'dist', 'webview', entry), 'utf-8')
  const nonce = getNonce()

  const webviewRoot = vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview'))
  html = html.replace(
    /(<(?:script|link)[^>]*?\s+(?:src|href)=")(\.\/[^"]+)(")/g,
    (_match, prefix, assetPath, suffix) => {
      const uri = vscode.Uri.joinPath(webviewRoot, assetPath.replace('./', ''))
      return `${prefix}${webview.asWebviewUri(uri).toString()}${suffix}`
    }
  )
  html = html.replace(/<script/g, `<script nonce="${nonce}"`)

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
  ].join('; ')
  html = html.replace(
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
  )
  return html
}

function getNonce(): string {
  const text = `${Date.now()}-${Math.random()}`
  return Buffer.from(text).toString('base64')
}
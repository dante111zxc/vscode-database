const KEYWORDS =
  'SELECT|FROM|WHERE|GROUP|HAVING|ORDER|BY|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE' +
  '|CREATE|ALTER|DROP|TRUNCATE|TABLE|INDEX|VIEW|SCHEMA|DATABASE|AS|AND|OR|NOT|NULL|IS|IN' +
  '|EXISTS|LIKE|BETWEEN|ALL|ANY|SOME|INNER|LEFT|RIGHT|FULL|OUTER|JOIN|ON|CROSS|UNION|DISTINCT' +
  '|CASE|WHEN|THEN|ELSE|END|ASC|DESC|WITH|PRIMARY|FOREIGN|REFERENCES|USING|TABLESPACE'

const TOKEN_RE = new RegExp(
  `('(?:''|[^'])*'|"(?:[^"]*)"|--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|\\b\\d+(?:\\.\\d+)?\\b|\\b(?:${KEYWORDS})\\b)`,
  'g'
)

export function highlightSql(sql: string): string {
  let html = ''
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(sql)) !== null) {
    const token = match[0]
    html += escapeHtml(sql.slice(lastIndex, match.index))
    html += `<span class="${tokenClass(token)}">${escapeHtml(token)}</span>`
    lastIndex = match.index + token.length
    if (match.index === re.lastIndex) {
      re.lastIndex += 1
    }
  }
  return html + escapeHtml(sql.slice(lastIndex))
}

function tokenClass(token: string): string {
  if (token.startsWith("'") || token.startsWith('"')) {
    return 'tok-string'
  }
  if (token.startsWith('--') || token.startsWith('/*')) {
    return 'tok-comment'
  }
  if (/^\d/.test(token)) {
    return 'tok-number'
  }
  return 'tok-keyword'
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
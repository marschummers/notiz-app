export const RICH_TEXT_PREFIX = 'notiz-rich-v1:'

const LINK_PATTERN = /\[\[([^\]:]+):([^\]]+)\]\]/g
const ALLOWED_TAGS = new Set(['BR', 'DIV', 'P', 'STRONG', 'EM', 'U', 'SPAN'])
const ALLOWED_COLORS = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i

function cleanElement(source: Element, targetDocument: Document): Node {
  const normalizedTag = source.tagName === 'B' ? 'STRONG' : source.tagName === 'I' ? 'EM' : source.tagName
  if (!ALLOWED_TAGS.has(normalizedTag)) {
    const fragment = targetDocument.createDocumentFragment()
    for (const child of Array.from(source.childNodes)) fragment.appendChild(cleanNode(child, targetDocument))
    return fragment
  }

  const target = targetDocument.createElement(normalizedTag.toLowerCase())
  if (normalizedTag === 'SPAN') {
    const color = (source as HTMLElement).style.color.trim()
    const size = Number.parseFloat((source as HTMLElement).style.fontSize)
    if (color && ALLOWED_COLORS.test(color)) target.style.color = color
    if (Number.isFinite(size) && size >= 10 && size <= 48) target.style.fontSize = `${size}px`
    if ((source as HTMLElement).style.fontWeight === 'bold' || Number.parseInt((source as HTMLElement).style.fontWeight, 10) >= 600) {
      target.style.fontWeight = 'bold'
    }
    if ((source as HTMLElement).style.fontStyle === 'italic') target.style.fontStyle = 'italic'
    if ((source as HTMLElement).style.textDecoration.includes('underline')) target.style.textDecoration = 'underline'
  }
  for (const child of Array.from(source.childNodes)) target.appendChild(cleanNode(child, targetDocument))
  return target
}

function cleanNode(source: Node, targetDocument: Document): Node {
  if (source.nodeType === Node.TEXT_NODE) return targetDocument.createTextNode(source.textContent ?? '')
  if (source instanceof Element) return cleanElement(source, targetDocument)
  return targetDocument.createDocumentFragment()
}

export function sanitizeRichTextHtml(html: string): string {
  const source = document.createElement('div')
  source.innerHTML = html
  const target = document.createElement('div')
  for (const child of Array.from(source.childNodes)) target.appendChild(cleanNode(child, document))
  return target.innerHTML
}

export function richTextToEditorHtml(value: string): string {
  if (value.startsWith(RICH_TEXT_PREFIX)) return sanitizeRichTextHtml(value.slice(RICH_TEXT_PREFIX.length))
  const container = document.createElement('div')
  container.textContent = value
  return container.innerHTML.replace(/\r?\n/g, '<br>')
}

export function serializeRichText(html: string): string {
  const clean = sanitizeRichTextHtml(html)
  return richTextHtmlToPlainText(clean).trim().length === 0 ? '' : `${RICH_TEXT_PREFIX}${clean}`
}

function richTextHtmlToPlainText(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const br of Array.from(container.querySelectorAll('br'))) br.replaceWith('\n')
  for (const block of Array.from(container.querySelectorAll('div, p'))) block.append('\n')
  return (container.textContent ?? '').replace(/\n+$/g, '')
}

export function richTextToPlainText(value: string): string {
  if (!value.startsWith(RICH_TEXT_PREFIX)) return value
  return richTextHtmlToPlainText(sanitizeRichTextHtml(value.slice(RICH_TEXT_PREFIX.length)))
}

export function richTextToDisplayHtml(value: string, resolveTitle: (pageId: string, fallback: string) => string): string {
  const container = document.createElement('div')
  container.innerHTML = richTextToEditorHtml(value)
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  for (const textNode of textNodes) {
    const text = textNode.data
    LINK_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    let lastIndex = 0
    const fragment = document.createDocumentFragment()
    let found = false
    while ((match = LINK_PATTERN.exec(text))) {
      found = true
      if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index))
      const link = document.createElement('span')
      link.className = 'page-link'
      link.dataset.pageId = match[1]
      link.textContent = `📄 ${resolveTitle(match[1], match[2])}`
      fragment.append(link)
      lastIndex = match.index + match[0].length
    }
    if (!found) continue
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex))
    textNode.replaceWith(fragment)
  }
  return container.innerHTML
}


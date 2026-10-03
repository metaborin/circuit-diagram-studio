import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircuitSvg, diagramBounds } from './CircuitSvg'
import type { CircuitDocument } from './types'

export function svgMarkup(document: CircuitDocument): string {
  const bounds = diagramBounds(document)
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderToStaticMarkup(createElement(CircuitSvg, {
    document, exportMode: true,
    viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
    width: bounds.width, height: bounds.height,
  }))
}

function filename(document: CircuitDocument, extension: string) {
  const title = [...document.title.trim()].filter(char => char.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || '回路図'
  return `${title}.${extension}`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = name
  window.document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadSvg(document: CircuitDocument) {
  download(new Blob([svgMarkup(document)], { type: 'image/svg+xml;charset=utf-8' }), filename(document, 'svg'))
}

export async function downloadPng(document: CircuitDocument, scale = 3): Promise<void> {
  await window.document.fonts.ready
  const bounds = diagramBounds(document)
  const ratio = Math.max(1, Math.min(4, scale, 12000 / Math.max(bounds.width, bounds.height)))
  const url = URL.createObjectURL(new Blob([svgMarkup(document)], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(bounds.width * ratio)
    canvas.height = Math.ceil(bounds.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('このブラウザではPNGを生成できません。SVG保存をお試しください。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNGを生成できませんでした。')), 'image/png'))
    download(blob, filename(document, 'png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadJson(document: CircuitDocument) {
  download(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json;charset=utf-8' }), filename(document, 'json'))
}

export function printDiagram(document: CircuitDocument) {
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('印刷画面を開けませんでした。このサイトのポップアップを許可してください。')
  popup.opener = null
  const doc = popup.document
  doc.open()
  doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>回路図の印刷・PDF保存</title><style>body{margin:24px;font-family:Meiryo,sans-serif;color:#111;background:white}header{padding:16px;background:#f1f5f9;margin-bottom:24px;font-size:14px}button{padding:10px 20px;cursor:pointer}main{text-align:center}main svg{max-width:100%;height:auto;max-height:85vh}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}header{display:none}main svg{max-width:100%;max-height:180mm;break-inside:avoid}}</style></head><body><header><p>印刷ダイアログの送信先で「PDFに保存」を選ぶと、ベクターのPDFを保存できます。用紙・向き・倍率を確認してください。</p><button id="print">印刷 / PDF保存</button></header><main></main></body></html>')
  doc.close()
  // Only renderer-created SVG enters this document; editable strings are React-escaped.
  const parsed = new DOMParser().parseFromString(svgMarkup(document), 'image/svg+xml')
  doc.querySelector('main')?.append(doc.importNode(parsed.documentElement, true))
  doc.getElementById('print')?.addEventListener('click', () => popup.print())
  void doc.fonts.ready.then(() => setTimeout(() => { popup.focus(); popup.print() }, 200))
}

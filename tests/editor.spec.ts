import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { CircuitDocument, CircuitComponent, Anchor } from '../src/types'

const storageKey = 'circuit-diagram-studio:v1'
const paper = (page: Page) => page.locator('.paper > svg')
const current = (page: Page): Promise<CircuitDocument> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey)
const key = (anchor: Anchor) => anchor.type === 'component' ? `${anchor.id}:${anchor.port}` : anchor.id

// Independent connected-component calculation: component terminals stay separate.
function networks(doc: CircuitDocument) {
  const parent = new Map<string, string>()
  doc.components.forEach(c => [0, 1].forEach(p => parent.set(`${c.id}:${p}`, `${c.id}:${p}`)))
  doc.junctions.forEach(j => parent.set(j.id, j.id))
  const root = (id: string): string => parent.get(id) === id ? id : root(parent.get(id)!)
  doc.wires.forEach(w => parent.set(root(key(w.from)), root(key(w.to))))
  return new Set([...parent.keys()].map(root)).size
}

async function coordinates(page: Page, x: number, y: number) {
  await paper(page).scrollIntoViewIfNeeded()
  const box = (await paper(page).boundingBox())!
  return { x: box.x + x * box.width / 1040, y: box.y + y * box.height / 680 }
}
async function canvasClick(page: Page, x: number, y: number) {
  const p = await coordinates(page, x, y)
  await page.mouse.click(p.x, p.y)
}
async function selectComponent(page: Page, c: CircuitComponent) { await canvasClick(page, c.x, c.y) }
async function chooseTemplate(page: Page, id: string) {
  await page.getByRole('button', { name: 'ひな形', exact: true }).click()
  await page.getByTestId(`template-${id}`).click()
}
async function addPart(page: Page, name: string, x: number, y: number) {
  await page.getByRole('button', { name: '部品', exact: true }).click()
  await page.getByTitle(`${name}を追加`, { exact: true }).click()
  await canvasClick(page, x, y)
  return (await current(page)).components.at(-1)!
}
async function exportDownload(page: Page, format: 'SVG' | 'PNG', info: TestInfo) {
  await page.getByRole('button', { name: '図を書き出す' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: new RegExp(`^${format}画像`) }).click()
  const file = await downloaded
  const path = info.outputPath(`diagram.${format.toLowerCase()}`)
  await file.saveAs(path)
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`))
  return { path, buffer: await readFile(path) }
}
async function saveJson(page: Page, info: TestInfo) {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '編集データを保存', exact: true }).click()
  const path = info.outputPath('circuit.json')
  await (await downloaded).saveAs(path)
  return path
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(paper(page)).toBeVisible()
})

test('desktop drag, rotation, labels, duplicate/delete and history preserve terminal connections', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const initial = await current(page)
  expect(networks(initial)).toBe(3)
  const resistor = initial.components.find(c => c.kind === 'resistor')!
  const from = await coordinates(page, resistor.x, resistor.y)
  const to = await coordinates(page, resistor.x + 60, resistor.y + 100)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  expect((await current(page)).components.find(c => c.id === resistor.id)).toMatchObject({ x: resistor.x + 60, y: resistor.y + 100 })
  for (const rotation of [90, 180, 270, 0]) {
    await page.getByRole('button', { name: '90°回転', exact: true }).click()
    const doc = await current(page)
    expect(doc.components.find(c => c.id === resistor.id)?.rotation).toBe(rotation)
    expect(doc.wires).toEqual(initial.wires)
    expect(networks(doc)).toBe(3)
  }
  await page.getByLabel('記号', { exact: true }).fill('R_12')
  await page.getByLabel('値', { exact: true }).fill('2.2')
  await page.getByLabel('単位', { exact: true }).fill('kΩ')
  await page.getByLabel('補足ラベル').fill('計算問題')
  await expect(paper(page).locator('tspan[baseline-shift="sub"]')).toHaveText(['12'])
  await page.getByLabel('問題用の表示').selectOption('question')
  await expect(paper(page)).toContainText('? kΩ')
  await page.getByLabel('問題用の表示').selectOption('blank')
  await expect(paper(page)).toContainText('＿＿ kΩ')
  await page.getByLabel('問題用の表示').selectOption('hidden')
  await expect(paper(page)).not.toContainText('計算問題')
  await page.getByLabel('問題用の表示').selectOption('show')
  await page.getByRole('button', { name: '複製', exact: true }).click()
  expect((await current(page)).components).toHaveLength(4)
  await page.getByRole('button', { name: '削除', exact: true }).click()
  expect((await current(page)).components).toHaveLength(3)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect((await current(page)).components).toHaveLength(4)
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  expect((await current(page)).components).toHaveLength(3)
  await page.screenshot({ path: info.outputPath('desktop-editor.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('create arbitrary circuit through ports, split wires for a branch and move it', async ({ page }, info) => {
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '空白の図を作成' }).click()
  const source = await addPart(page, '直流電源', 200, 320)
  await page.getByLabel('向き', { exact: true }).selectOption('90')
  const r1 = await addPart(page, '抵抗', 600, 200)
  await page.getByRole('button', { name: '配線', exact: true }).click()
  for (const [x, y] of [[200, 280], [200, 200], [560, 200], [640, 200], [800, 200], [800, 500], [200, 500], [200, 360]]) await canvasClick(page, x, y)
  await page.keyboard.press('Escape')
  expect(networks(await current(page))).toBe(2)
  const r2 = await addPart(page, '抵抗', 500, 360)
  await page.getByLabel('向き', { exact: true }).selectOption('90')
  expect(networks(await current(page))).toBe(4)
  await page.getByRole('button', { name: '配線', exact: true }).click()
  for (const [x, y] of [[500, 200], [500, 320], [500, 400], [500, 500]]) await canvasClick(page, x, y)
  await page.keyboard.press('Escape')
  const branched = await current(page)
  expect(networks(branched)).toBe(2)
  expect(branched.components.map(c => c.id)).toEqual([source.id, r1.id, r2.id])
  expect(await paper(page).locator('[data-type="junction"] circle[fill="#111111"]').count()).toBe(2)
  await selectComponent(page, { ...r2, rotation: 90 })
  await page.getByLabel('X 座標', { exact: true }).fill('540')
  expect((await current(page)).wires).toEqual(branched.wires)
  expect(networks(await current(page))).toBe(2)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect((await current(page)).components.find(c => c.id === r2.id)?.x).toBe(500)
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  expect(networks(await current(page))).toBe(2)
  await page.screenshot({ path: info.outputPath('custom-branch.png'), fullPage: true })
})

test('all component symbols, switch, annotations and terminal names are editable', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '空白の図を作成' }).click()
  const names = ['抵抗', 'コイル', 'コンデンサ', '電池', '直流電源', '交流電源', 'スイッチ', '電流計', '電圧計']
  for (const [i, name] of names.entries()) {
    await addPart(page, name, 200 + i % 3 * 280, 140 + Math.floor(i / 3) * 180)
    if (name === 'スイッチ') {
      await page.getByLabel('スイッチを閉じる').check()
      expect((await current(page)).components.at(-1)?.closed).toBe(true)
    }
  }
  expect((await current(page)).components).toHaveLength(9)
  await page.getByLabel('抵抗の記号').selectOption('zigzag')
  for (const [i, name] of ['テキスト', '電流矢印', '電圧・極性'].entries()) {
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await canvasClick(page, 280 + i * 240, 600)
    await page.getByLabel('表示テキスト').fill(['問1：合成抵抗を求めよ', 'I_1 = ? mA', 'U_1 = ? V'][i])
    if (i) await page.getByRole('button', { name: '90°回転', exact: true }).click()
  }
  await page.getByRole('button', { name: '端子', exact: false }).filter({ hasText: '端子' }).click()
  await canvasClick(page, 920, 600)
  await page.getByLabel('端子名').fill('端子A')
  const doc = await current(page)
  expect(doc.annotations).toHaveLength(3)
  expect(doc.annotations.map(a => a.rotation)).toEqual([0, 90, 90])
  expect(doc.junctions.at(-1)).toMatchObject({ terminal: true, label: '端子A' })
})

test('all 16 templates render, topology is correct and switching protects edits', async ({ page }, info) => {
  const templateNets: Record<string, number> = {
    'dc-simple': 2, 'resistor-series': 3, 'resistor-parallel': 2, 'resistor-mixed': 3,
    'resistor-bridge': 4, 'capacitor-series': 3, 'capacitor-parallel': 2,
    'ac-r': 2, 'ac-l': 2, 'ac-c': 2, 'ac-rc': 3, 'ac-rl': 3, 'ac-rlc': 4,
    'ac-parallel-rlc': 2, 'ac-mixed': 4, 'measurement': 3,
  }
  for (const [id, count] of Object.entries(templateNets)) {
    await chooseTemplate(page, id)
    const doc = await current(page)
    expect(networks(doc), id).toBe(count)
    expect(await paper(page).locator('[data-type="component"]').count()).toBe(doc.components.length)
    await expect(paper(page)).toBeVisible()
    if (['resistor-bridge', 'ac-mixed', 'ac-parallel-rlc'].includes(id)) await paper(page).screenshot({ path: info.outputPath(`${id}.png`) })
  }
  await page.getByLabel('図のタイトル').fill('保存前の授業用回路')
  const edited = await current(page)
  page.once('dialog', dialog => dialog.dismiss())
  await chooseTemplate(page, 'dc-simple')
  expect(await current(page)).toEqual(edited)
  page.once('dialog', dialog => dialog.accept())
  await chooseTemplate(page, 'dc-simple')
  expect(networks(await current(page))).toBe(2)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(await current(page)).toEqual(edited)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '空白の図を作成' }).click()
  expect(await current(page)).toEqual(edited)
})

test('AC JSON roundtrip, high-resolution monochrome SVG/PNG and print PDF preserve labels', async ({ page, context }, info) => {
  await chooseTemplate(page, 'ac-mixed')
  const ac = (await current(page)).components.find(c => c.kind === 'ac')!
  await selectComponent(page, ac)
  await page.getByLabel('単位', { exact: true }).fill('V RMS')
  await page.getByLabel('補足ラベル').fill('50 Hz / ∠30°')
  await page.getByLabel('図のタイトル').fill('交流 RLC 教材：50 Hz')
  const before = await current(page)
  const jsonPath = await saveJson(page, info)
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toEqual(before)
  await chooseTemplate(page, 'dc-simple')
  const choosingFile = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '編集データを開く', exact: true }).click()
  await (await choosingFile).setFiles(jsonPath)
  await expect(page.getByLabel('図のタイトル')).toHaveValue(before.title)
  expect(await current(page)).toEqual(before)
  await page.reload()
  expect(await current(page)).toEqual(before)
  const svg = (await exportDownload(page, 'SVG', info)).buffer.toString('utf8')
  for (const label of ['100 V RMS', '50 Hz / ∠30°', '100 mH', '10 μF']) expect(svg).toContain(label)
  expect(svg).not.toContain('circuit-grid')
  expect(svg).not.toContain('data-type="port"')
  const colors = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(m => m[1])
  expect(colors.every(color => ['none', 'white', '#111111'].includes(color))).toBe(true)
  const png = (await exportDownload(page, 'PNG', info)).buffer
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20)
  expect(pngWidth).toBeGreaterThan(2400)
  expect(pngHeight).toBeGreaterThan(1000)
  // Decode the actual downloaded image with the browser and check all output pixels.
  const pixels = await page.evaluate(async data => {
    const img = new Image(); img.src = data; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const bytes = ctx.getImageData(0, 0, img.width, img.height).data
    let colored = 0, transparent = 0, dark = 0
    for (let i = 0; i < bytes.length; i += 4) { if (bytes[i] !== bytes[i + 1] || bytes[i] !== bytes[i + 2]) colored++; if (bytes[i + 3] !== 255) transparent++; if (bytes[i] < 128) dark++ }
    return { colored, transparent, dark }
  }, `data:image/png;base64,${png.toString('base64')}`)
  expect(pixels.colored).toBe(0); expect(pixels.transparent).toBe(0); expect(pixels.dark).toBeGreaterThan(1000)
  await context.addInitScript(() => { window.print = () => { document.documentElement.dataset.printCalled = 'true' } })
  await page.getByRole('button', { name: '図を書き出す' }).click()
  const opened = page.waitForEvent('popup')
  await page.getByRole('button', { name: /^印刷 \/ PDF/ }).click()
  const popup = await opened
  await expect(popup.locator('main svg')).toBeVisible()
  await popup.getByRole('button', { name: '印刷 / PDF保存' }).click()
  await expect(popup.locator('html')).toHaveAttribute('data-print-called', 'true')
  await popup.emulateMedia({ media: 'print' })
  await expect(popup.locator('header')).toBeHidden()
  expect(await popup.locator('main svg').textContent()).toContain('50 Hz / ∠30°')
  const pdf = await popup.pdf({ path: info.outputPath('print-preview.pdf'), preferCSSPageSize: true, printBackground: true })
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  await popup.screenshot({ path: info.outputPath('print-preview.png'), fullPage: true })
  await popup.close()
  await page.screenshot({ path: info.outputPath('desktop-ac-editor.png'), fullPage: true })
})

test('crossing independent loops stay disconnected until explicit junction join, then Undo restores them', async ({ page }, info) => {
  const part = (id: string, kind: CircuitComponent['kind'], x: number, y: number, rotation: 0 | 90): CircuitComponent => ({ id, kind, x, y, rotation, label: id, value: '10', unit: kind === 'battery' ? 'V' : 'Ω', detail: '', labelMode: 'show', labelDx: 0, labelDy: -50 })
  const port = (id: string, n: 0 | 1): Anchor => ({ type: 'component', id, port: n })
  const fixture: CircuitDocument = { version: 1, title: '独立した2回路の交差', components: [part('E1', 'battery', 200, 240, 90), part('R1', 'resistor', 500, 120, 0), part('E2', 'battery', 420, 520, 90), part('R2', 'resistor', 900, 360, 0)], junctions: [], annotations: [], settings: { resistorStyle: 'iec', margin: 40, showTitle: true }, wires: [
    { id: 'w1', from: port('E1', 0), to: port('R1', 0), route: 'hv', via: [{ x: 200, y: 120 }] },
    { id: 'w2', from: port('R1', 1), to: port('E1', 1), route: 'hv', via: [{ x: 700, y: 120 }, { x: 700, y: 440 }, { x: 200, y: 440 }] },
    { id: 'w3', from: port('E2', 0), to: port('R2', 0), route: 'hv', via: [{ x: 420, y: 360 }] },
    { id: 'w4', from: port('R2', 1), to: port('E2', 1), route: 'hv', via: [{ x: 980, y: 360 }, { x: 980, y: 600 }, { x: 420, y: 600 }] },
  ] }
  await page.getByLabel('編集データのJSONファイルを開く').setInputFiles({ name: 'crossing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await expect(page.getByLabel('図のタイトル')).toHaveValue(fixture.title)
  expect(networks(await current(page))).toBe(4)
  expect(await paper(page).locator('[data-type="wire"][data-id="w3"] path').last().getAttribute('d')).toMatch(/H 694 M 706 360/)
  await page.getByRole('button', { name: /接続点/, exact: false }).click()
  await canvasClick(page, 700, 360)
  expect(networks(await current(page))).toBe(4)
  await page.getByRole('button', { name: 'この位置の配線を結合' }).click()
  expect(networks(await current(page))).toBe(3)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(networks(await current(page))).toBe(4)
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  expect(networks(await current(page))).toBe(3)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  const restored = await current(page), path = await saveJson(page, info)
  await chooseTemplate(page, 'dc-simple')
  await page.getByLabel('編集データのJSONファイルを開く').setInputFiles(path)
  await expect(page.getByLabel('図のタイトル')).toHaveValue(fixture.title)
  expect(await current(page)).toEqual(restored)
  expect(networks(await current(page))).toBe(4)
  await paper(page).screenshot({ path: info.outputPath('nonconnected-crossings.png') })
})

test('mobile has no document overflow and supports basic component edits and export', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('図のタイトル')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const resistor = (await current(page)).components.find(c => c.kind === 'resistor')!
  await selectComponent(page, resistor)
  await page.getByLabel('値', { exact: true }).fill('47')
  await page.getByRole('button', { name: '90°回転', exact: true }).click()
  expect((await current(page)).components.find(c => c.id === resistor.id)).toMatchObject({ value: '47', rotation: 90 })
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(networks(await current(page))).toBe(3)
  const { buffer } = await exportDownload(page, 'SVG', info)
  expect(buffer.toString('utf8')).toContain('47 Ω')
  await page.getByRole('button', { name: '使い方', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '使い方を閉じる' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('mobile-editor.png'), fullPage: true })
})

test('autosaved draft still prompts before template replacement after reload', async ({ page }) => {
  await page.getByLabel('図のタイトル').fill('未書き出しの授業用下書き')
  const draft = await current(page)
  await page.reload()
  await expect(page.getByLabel('図のタイトル')).toHaveValue(draft.title)
  page.once('dialog', dialog => dialog.dismiss())
  await chooseTemplate(page, 'resistor-bridge')
  expect(await current(page)).toEqual(draft)
  page.once('dialog', dialog => dialog.accept())
  await chooseTemplate(page, 'resistor-bridge')
  expect(networks(await current(page))).toBe(4)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(await current(page)).toEqual(draft)
})

test('ambiguous overlap blocks diagram export while JSON stays available', async ({ page }, info) => {
  const original = await current(page)
  const [first, second] = original.components.filter(c => c.kind === 'resistor')
  await selectComponent(page, first)
  await page.getByLabel('X 座標', { exact: true }).fill(String(second.x))
  let downloads = 0
  page.on('download', () => { downloads++ })
  await page.getByRole('button', { name: '図を書き出す' }).click()
  await page.getByRole('button', { name: /^SVG画像/ }).click()
  await expect(page.getByRole('status')).toContainText('出力を停止しました')
  expect(downloads).toBe(0)
  const jsonPath = await saveJson(page, info)
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toEqual(await current(page))
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(await current(page)).toEqual(original)
  expect((await exportDownload(page, 'SVG', info)).buffer.toString('utf8')).toContain('10 Ω')
})

test('first visit starts with templates and file status follows save, edit, undo and reopen', async ({ page }, info) => {
  await expect(page.getByRole('button', { name: 'ひな形', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.file-save-status')).toHaveText('編集データは未保存')
  await chooseTemplate(page, 'resistor-parallel')
  await expect(page.getByRole('button', { name: '部品', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const original = await current(page)
  const jsonPath = await saveJson(page, info)
  await expect(page.locator('.file-save-status')).toHaveText('編集データは保存済み')
  const resistor = original.components.find(c => c.kind === 'resistor')!
  await selectComponent(page, resistor)
  await page.getByLabel('値', { exact: true }).fill('68')
  await expect(page.locator('.file-save-status')).toHaveText('編集データは未保存')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.locator('.file-save-status')).toHaveText('編集データは保存済み')
  expect(await current(page)).toEqual(original)
  await page.reload()
  await expect(page.locator('.file-save-status')).toHaveText('編集データの保存を確認')
  expect(await current(page)).toEqual(original)
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('編集データのJSONファイルを開く').setInputFiles(jsonPath)
  await expect(page.locator('.file-save-status')).toHaveText('編集データは保存済み')
  expect(await current(page)).toEqual(original)
  await expect(page.getByRole('status')).toContainText('編集データを開きました')
})

test('keyboard selection, movement and recovery preserve connections; overlays keep focus', async ({ page }) => {
  const original = await current(page)
  const resistor = original.components.find(c => c.kind === 'resistor')!
  const element = paper(page).locator(`[data-type="component"][data-id="${resistor.id}"]`)
  await page.getByRole('button', { name: '全体表示', exact: true }).focus()
  // Wires, then the battery, then the first resistor are reachable with Tab.
  for (let i = 0; i < original.wires.length + 2; i++) await page.keyboard.press('Tab')
  await expect(element).toBeFocused()
  expect(await element.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('記号', { exact: true })).toHaveValue(resistor.label)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('r')
  expect((await current(page)).components.find(c => c.id === resistor.id)).toMatchObject({ x: resistor.x + 20, rotation: 90 })
  expect((await current(page)).wires).toEqual(original.wires)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  expect(await current(page)).toEqual(original)
  await element.press('Space')
  await expect(page.getByLabel('記号', { exact: true })).toHaveValue(resistor.label)

  const exporting = page.getByRole('button', { name: '図を書き出す', exact: true })
  await exporting.click()
  await expect(page.getByRole('button', { name: /^PNG画像/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.export-menu')).toHaveCount(0)
  await expect(exporting).toBeFocused()
  await expect(page.getByLabel('記号', { exact: true })).toHaveValue(resistor.label)

  const help = page.getByRole('button', { name: '使い方', exact: true })
  const close = page.getByRole('button', { name: '使い方を閉じる' })
  await help.click()
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '編集をはじめる' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '編集をはじめる' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(help).toBeFocused()
  expect(await current(page)).toEqual(original)
})

test('guidance, readable labels and controls fit desktop and narrow layouts', async ({ page }, info) => {
  await page.getByRole('button', { name: '部品', exact: true }).click()
  for (const [width, height] of [[1600, 1000], [1366, 768], [1280, 720], [1100, 768], [1000, 768], [950, 768], [768, 1024], [621, 900], [620, 900], [390, 844], [320, 800]]) {
    await page.setViewportSize({ width, height })
    const layout = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('.document-actions button, .canvas-toolbar button')]
      const boxes = controls.map(el => el.getBoundingClientRect())
      const guide = document.querySelector('.canvas-hint')!.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: controls.some((el, index) => boxes[index].left < 0 || boxes[index].right > innerWidth || el.scrollWidth > el.clientWidth + 1),
        overlap: boxes.some((a, i) => boxes.slice(i + 1).some(b => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)),
        fontSize: parseFloat(getComputedStyle(document.querySelector('.part-button')!).fontSize),
        guideVisible: guide.top >= 0 && guide.bottom <= innerHeight,
      }
    })
    expect(layout.overflow, `${width}px page overflow`).toBe(false)
    expect(layout.clipped, `${width}px clipped controls`).toBe(false)
    expect(layout.overlap, `${width}px overlapping controls`).toBe(false)
    expect(layout.fontSize).toBeGreaterThanOrEqual(12)
    if (width >= 1100) expect(layout.guideVisible).toBe(true)
    if (width === 1366 || width === 390) await page.screenshot({ path: info.outputPath(`usability-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '配線', exact: true }).click()
  await expect(page.locator('.canvas-hint')).toContainText('配線：始点を選ぶ')
  await page.getByRole('button', { name: '選択に戻る', exact: true }).click()
  await expect(page.getByRole('button', { name: '選択・移動', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.getByRole('button', { name: '全体表示', exact: true }).click()
  await expect.poll(() => page.locator('.canvas-scroll').evaluate(el => el.scrollHeight <= el.clientHeight + 2 && el.scrollWidth <= el.clientWidth + 2)).toBe(true)
})

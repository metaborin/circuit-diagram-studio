import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CircuitDocument } from '../src/types'

// Exercise the real production build. The fixture changes only the worker version
// to reproduce an update while two editors are open, without mutating dist files.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const base = '/circuit-diagram-studio/'
const saveKey = 'circuit-diagram-studio:v1'
let server: Server, origin: string, nextVersion = false
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname
    if (pathname === '/bootstrap') { response.writeHead(200, {'content-type':'text/html'}); response.end('<!doctype html><title>Local test fixture</title>'); return }
    if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return }
    const relative = decodeURIComponent(pathname.slice(base.length)) || 'index.html'
    if (relative.split('/').includes('..')) { response.writeHead(400); response.end(); return }
    try {
      let bytes = await readFile(path.join(dist, relative))
      if (relative === 'sw.js' && nextVersion) bytes = Buffer.from(bytes.toString().replace(/const VERSION = ["'][a-f0-9]+["']/, `const VERSION = "${'b'.repeat(20)}"`))
      const type: Record<string,string> = {'.js':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}
      response.writeHead(200, {'content-type':type[path.extname(relative)] || 'application/octet-stream','cache-control':'no-store'})
      response.end(bytes)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address=server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local test server')
  origin=`http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())) })
test.beforeEach(() => { nextVersion=false })

async function ready(page: Page) {
  await expect(page.getByText('オフラインで利用できます',{exact:true})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
}
async function download(page: Page, format: 'JSON'|'SVG'|'PNG', info: TestInfo) {
  if (format !== 'JSON') await page.getByRole('button',{name:'図を書き出す'}).click()
  const pending=page.waitForEvent('download')
  await page.getByRole('button',{name:format==='JSON'?'編集データを保存':new RegExp(`^${format}画像`),exact:format==='JSON'}).click()
  const file=await pending, target=info.outputPath(`offline.${format.toLowerCase()}`)
  await file.saveAs(target)
  return readFile(target)
}

test('installed build preserves other caches, edits offline and exports JSON SVG PNG and print PDF',async({page,context},info)=>{
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/bootstrap')
  await page.evaluate(async()=>{const cache=await caches.open('other-app-keep');await cache.put('/sentinel',new Response('untouched'))})
  await page.goto(origin+base); await ready(page)
  const session=await context.newCDPSession(page)
  const manifest=await session.send('Page.getAppManifest')
  expect(manifest.errors).toEqual([])
  expect(JSON.parse(manifest.data!)).toMatchObject({id:base,scope:base,start_url:base,display:'standalone'})
  await page.getByLabel('図のタイトル').fill('オフライン回路QA')
  const before=await page.evaluate(key=>localStorage.getItem(key),saveKey)
  expect(JSON.parse((await download(page,'JSON',info)).toString())).toEqual(JSON.parse(before!))
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByLabel('図のタイトル')).toHaveValue('オフライン回路QA')
  // navigator.onLine can still report the OS network link while requests are blocked.
  expect(await page.evaluate(async()=>{try{await fetch('/bootstrap?offline-probe',{cache:'no-store'});return false}catch{return true}})).toBe(true)
  await expect(page.getByText(/^オフラインで利用(できます|中)$/)).toBeVisible()
  const resistor = await page.evaluate(key => (JSON.parse(localStorage.getItem(key)!) as CircuitDocument).components.find(part=>part.kind==='resistor')!,saveKey)
  const screenPoint = await page.locator('.paper svg').evaluate((element,point)=>{
    const transformed=new DOMPoint(point.x,point.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
    return {x:transformed.x,y:transformed.y}
  },resistor)
  await page.mouse.click(screenPoint.x,screenPoint.y)
  await page.getByLabel('値',{exact:true}).fill('22')
  const edited=await page.evaluate(key=>localStorage.getItem(key),saveKey)
  expect(edited).not.toBe(before)
  expect(JSON.parse((await download(page,'JSON',info)).toString())).toEqual(JSON.parse(edited!))
  expect((await download(page,'SVG',info)).toString()).toContain('22')
  const png=await download(page,'PNG',info)
  expect(png.subarray(1,4).toString()).toBe('PNG')
  await context.addInitScript(()=>{window.print=()=>{document.documentElement.dataset.printCalled='true'}})
  await page.getByRole('button',{name:'図を書き出す'}).click()
  const popupPromise=page.waitForEvent('popup')
  await page.getByRole('button',{name:/^印刷 \/ PDF/}).click()
  const popup=await popupPromise
  await expect(popup.locator('main svg')).toBeVisible()
  await popup.getByRole('button',{name:'印刷 / PDF保存'}).click()
  await expect(popup.locator('html')).toHaveAttribute('data-print-called','true')
  const pdf=await popup.pdf({path:info.outputPath('offline.pdf'),preferCSSPageSize:true})
  expect(pdf.subarray(0,4).toString()).toBe('%PDF')
  await popup.close()
  expect(await page.evaluate(async()=> (await (await caches.open('other-app-keep')).match('/sentinel'))?.text())).toBe('untouched')
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({path:info.outputPath('pwa-offline-mobile.png'),fullPage:true})
  expect(errors).toEqual([])
})

test('a new worker waits across two editing tabs without reload, save writes or lost undo history',async({page,context},info)=>{
  await page.goto(origin+base); await ready(page)
  const second=await context.newPage(); await second.goto(origin+base); await ready(second)
  await page.getByLabel('図のタイトル').fill('更新待機中の編集を保持')
  const before=await page.evaluate(key=>localStorage.getItem(key),saveKey)
  await page.evaluate(()=>{document.documentElement.dataset.editingSession='original'})
  nextVersion=true
  await page.getByText('アプリ・更新について',{exact:true}).click()
  await page.getByRole('button',{name:'更新を確認',exact:true}).click()
  await expect(page.locator('.pwa-update')).toBeVisible()
  await expect(second.locator('.pwa-update')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-editing-session','original')
  await expect(page.getByLabel('図のタイトル')).toHaveValue('更新待機中の編集を保持')
  expect(await page.evaluate(key=>localStorage.getItem(key),saveKey)).toBe(before)
  expect(await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {active:r?.active?.state,waiting:r?.waiting?.state,controller:navigator.serviceWorker.controller===r?.active}})).toEqual({active:'activated',waiting:'installed',controller:true})
  await page.getByRole('button',{name:'元に戻す',exact:true}).click()
  await page.getByRole('button',{name:'やり直す',exact:true}).click()
  await expect(page.getByLabel('図のタイトル')).toHaveValue('更新待機中の編集を保持')
  await page.screenshot({path:info.outputPath('pwa-update-waiting.png'),fullPage:true})
  await download(page,'JSON',info)
  await page.close(); await second.close()
  const reopened=await context.newPage(); await reopened.goto(origin+base); await ready(reopened)
  await expect(reopened.locator('.pwa-update')).toHaveCount(0)
  await expect(reopened.getByLabel('図のタイトル')).toHaveValue('更新待機中の編集を保持')
  expect(await reopened.evaluate(()=>caches.keys())).toContain('metaborin/circuit-diagram-studio/'+'b'.repeat(20))
})

test('failed service-worker registration leaves editing and file saving available',async({page},info)=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator.serviceWorker,'register',{value:()=>Promise.reject(new Error('unavailable'))})
  })
  await page.goto(origin+base)
  await expect(page.locator('.pwa-message')).toContainText('準備を開始できませんでした')
  await page.getByLabel('図のタイトル').fill('オンラインで編集を継続')
  expect(JSON.parse((await download(page,'JSON',info)).toString()).title).toBe('オンラインで編集を継続')
})

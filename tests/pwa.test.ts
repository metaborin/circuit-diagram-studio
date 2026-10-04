import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const base = '/circuit-diagram-studio/'
const origin = 'https://metaborin.github.io'
const prefix = 'metaborin/circuit-diagram-studio/'
const version = 'a'.repeat(20)
const current = prefix + version
const assets = [base+'index.html',base+'assets/main.js',base+'assets/main.css']
const template = readFileSync(new URL('../scripts/service-worker.template.js', import.meta.url),'utf8')
const source = template.replace("'__BUILD_VERSION__'",JSON.stringify(version)).replace('/*__PRECACHE__*/ []',JSON.stringify(assets))

function worker(failInstall = false) {
  type Listener = (event: Record<string, unknown>) => void
  const listeners = new Map<string, Listener>()
  const caches = new Map<string, Map<string, string>>()
  const deleted: string[] = [], network: string[] = []
  let claims = 0, installs: string[] = []
  const key = (url: string) => new URL(url,origin).href
  const open = async (name: string) => {
    if (!caches.has(name)) caches.set(name,new Map())
    return {
      match: async (url: string) => caches.get(name)!.get(key(url)),
      addAll: async (requests: { url: string }[]) => {
        installs = requests.map(request=>request.url)
        if (failInstall) throw new Error('asset unavailable')
        for (const request of requests) caches.get(name)!.set(key(request.url),'cached:'+request.url)
      },
    }
  }
  runInNewContext(source, {
    URL,
    Request: class { url: string; constructor(url: string) { this.url = url } },
    self: { location: { origin }, addEventListener: (name: string,listener: Listener) => listeners.set(name,listener), clients: { claim: async () => { claims++ } } },
    caches: { open, keys: async () => [...caches.keys()], delete: async (name: string) => { deleted.push(name); return caches.delete(name) } },
    fetch: async (request: { url: string }) => { network.push(request.url); throw new Error('offline') },
  })
  return {
    caches, deleted, network, claims: () => claims, installs: () => installs,
    failDownloads: () => { failInstall = true },
    async dispatch(name: string, extras: Record<string, unknown> = {}) {
      let completion: Promise<unknown> | undefined
      listeners.get(name)!({ ...extras,waitUntil: (promise: Promise<unknown>) => { completion=promise },respondWith: (promise: Promise<unknown>)=>{completion=promise} })
      return completion
    },
  }
}

describe('PWA worker safety', () => {
  it('installs every build asset without forcing activation, and rejects a partial install', async () => {
    const good=worker(); await good.dispatch('install'); expect(good.installs()).toEqual(assets)
    expect(good.claims()).toBe(0)
    const bad=worker(true); await expect(bad.dispatch('install')).rejects.toThrow('asset unavailable')
    expect(bad.deleted).toEqual([])
  })
  it('cleans only complete owned cache names and preserves current and foreign contents', async () => {
    const sw=worker()
    const old=prefix+'b'.repeat(20)
    const survivors=[current,'manabi-rpg-v4','workbox-precache-v2-other',prefix+'backup','metaborin/circuit-diagram-studio-copy/'+'c'.repeat(20)]
    for(const name of [old,...survivors]) sw.caches.set(name,new Map([['sentinel',name]]))
    await sw.dispatch('install')
    await sw.dispatch('activate')
    expect(sw.deleted).toEqual([old]); expect([...sw.caches.keys()]).toEqual(survivors)
    for(const name of survivors) expect(sw.caches.get(name)?.get('sentinel')).toBe(name)
    expect(sw.claims()).toBe(1)
  })
  it('retains the old cache and does not claim clients if a waiting build lost an asset', async () => {
    const sw=worker(); await sw.dispatch('install')
    const old=prefix+'b'.repeat(20)
    sw.caches.set(old,new Map([['saved-script','previous working build']]))
    sw.caches.get(current)!.delete(origin+assets[1])
    await expect(sw.dispatch('activate')).rejects.toThrow('Offline assets are incomplete')
    expect(sw.deleted).toEqual([])
    expect(sw.caches.get(old)?.get('saved-script')).toBe('previous working build')
    expect(sw.claims()).toBe(0)
  })
  it('serves only its own cached build and leaves other scopes and unknown assets alone', async () => {
    const sw=worker(); await sw.dispatch('install')
    sw.caches.set('foreign',new Map([[origin+base+'assets/main.js','wrong app']]))
    expect(await sw.dispatch('fetch',{request:{method:'GET',mode:'cors',url:origin+base+'assets/main.js'}})).toBe('cached:'+base+'assets/main.js')
    expect(await sw.dispatch('fetch',{request:{method:'GET',mode:'navigate',url:origin+base+'?view=1'}})).toBe('cached:'+base+'index.html')
    for(const url of [origin+'/another-app/',origin+'/circuit-diagram-studio-copy/',origin+base+'missing.js','https://example.com'+base]) {
      expect(await sw.dispatch('fetch',{request:{method:'GET',mode:'cors',url}})).toBeUndefined()
    }
    expect(sw.network).toEqual([])
  })
  it('reports offline-ready only when all assets remain, and ignores activation messages', async () => {
    const sw=worker(); await sw.dispatch('install')
    const messages: unknown[]=[]
    const event={data:{type:'CHECK_OFFLINE_READY'},ports:[{postMessage:(data:unknown)=>messages.push(data)}]}
    await sw.dispatch('message',event)
    expect(messages).toEqual([{type:'OFFLINE_READY',ready:true,version}])
    sw.caches.get(current)!.delete(origin+assets[1])
    sw.failDownloads()
    await sw.dispatch('message',event)
    expect(messages.at(-1)).toEqual({type:'OFFLINE_READY',ready:false,version})
    await sw.dispatch('message',{data:{type:'SKIP_WAITING'},ports:[]})
    expect(sw.claims()).toBe(0)
  })
  it('repairs browser-evicted assets on an online readiness check without touching foreign caches', async () => {
    const sw=worker(); await sw.dispatch('install')
    sw.caches.get(current)!.delete(origin+assets[1])
    sw.caches.set('other-app',new Map([['sentinel','keep']]))
    const messages: unknown[]=[]
    await sw.dispatch('message',{data:{type:'CHECK_OFFLINE_READY'},ports:[{postMessage:(data:unknown)=>messages.push(data)}]})
    expect(messages).toEqual([{type:'OFFLINE_READY',ready:true,version}])
    expect(sw.caches.get(current)?.has(origin+assets[1])).toBe(true)
    expect(sw.caches.get('other-app')?.get('sentinel')).toBe('keep')
    expect(sw.deleted).toEqual([])
  })
})

it('ships stable manifest identity and real PNG icons with the declared dimensions', () => {
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'))
  expect(manifest).toMatchObject({id:base,start_url:base,scope:base,display:'standalone'})
  expect(manifest.icons.map((icon:{purpose:string})=>icon.purpose)).toEqual(['any','any','maskable'])
  for(const icon of manifest.icons) {
    const png=readFileSync(new URL('../public/'+icon.src,import.meta.url))
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes)
    expect(icon.type).toBe('image/png')
  }
})

import { useEffect, useRef, useState } from 'react'
import './pwa.css'

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export function PwaPanel() {
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const installEvent = useRef<InstallEvent | null>(null)
  const [installable, setInstallable] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [ready, setReady] = useState(false)
  const [preparing, setPreparing] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('オフライン用の準備中です。初回はインターネットに接続してください。')

  useEffect(() => {
    if (!import.meta.env.PROD) return
    let alive = true
    const cleanup: (() => void)[] = []
    const listen = (target: EventTarget, name: string, listener: EventListener) => {
      target.addEventListener(name, listener)
      cleanup.push(() => target.removeEventListener(name, listener))
    }
    const inspect = async (reg: ServiceWorkerRegistration) => {
      if (!alive) return
      setWaiting(Boolean(reg.waiting))
      if (!reg.active) return
      const channel = new MessageChannel()
      const timer = window.setTimeout(() => {
        channel.port1.close()
        if (alive) { setPreparing(false); setMessage('オフライン用の保存を確認できませんでした。オンラインで開き直してください。') }
      }, 5000)
      cleanup.push(() => { clearTimeout(timer); channel.port1.close() })
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close()
        if (!alive || event.data?.type !== 'OFFLINE_READY') return
        setPreparing(false)
        setReady(event.data.ready === true)
        setMessage(event.data.ready ? '' : 'オフライン用の保存が一部不足しています。オンラインで開き直してください。')
      }
      reg.active.postMessage({ type: 'CHECK_OFFLINE_READY' }, [channel.port2])
    }
    listen(window, 'online', () => { setOnline(true); if (registration.current) void inspect(registration.current) })
    listen(window, 'offline', () => setOnline(false))
    listen(window, 'beforeinstallprompt', event => { event.preventDefault(); installEvent.current = event as InstallEvent; setInstallable(true) })
    listen(window, 'appinstalled', () => { installEvent.current = null; setInstalled(true); setInstallable(false) })
    setInstalled(window.matchMedia('(display-mode: standalone)').matches)
    if (!('serviceWorker' in navigator)) {
      setPreparing(false)
      setMessage('このブラウザではオフライン準備に対応していません。オンラインで利用できます。')
    } else {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL, updateViaCache: 'none',
      }).then(reg => {
        if (!alive) return
        registration.current = reg
        const observe = () => {
          const worker = reg.installing
          if (worker) listen(worker, 'statechange', () => {
            if (worker.state === 'redundant') { setPreparing(false); setMessage('新しい版の保存に失敗しました。現在の画面で編集を続けられます。') }
            void inspect(reg)
          })
          void inspect(reg)
        }
        listen(reg, 'updatefound', observe)
        listen(navigator.serviceWorker, 'controllerchange', () => { void inspect(reg) })
        observe()
      }).catch(() => { if (alive) { setPreparing(false); setMessage('オフライン用の準備を開始できませんでした。オンラインで利用できます。') } })
    }
    return () => { alive = false; cleanup.forEach(dispose => dispose()) }
  }, [])

  if (!import.meta.env.PROD) return null
  const install = async () => {
    const event = installEvent.current
    if (!event) return
    installEvent.current = null; setInstallable(false)
    try { await event.prompt(); await event.userChoice }
    catch { setMessage('ブラウザのメニューからインストールをお試しください。') }
  }
  const check = async () => {
    const reg = registration.current
    if (!reg || checking) return
    setChecking(true)
    try { await reg.update(); setWaiting(Boolean(reg.waiting)) }
    catch { setMessage('更新を確認できませんでした。接続を確認してお試しください。') }
    finally { setChecking(false) }
  }
  return <section className="pwa-panel" aria-label="アプリとオフライン利用" onKeyDown={event => event.stopPropagation()}>
    <div className="pwa-line"><span aria-live="polite">{ready ? online ? 'オフラインで利用できます' : 'オフラインで利用中' : preparing ? 'オフラインの準備を確認中' : online ? 'オンラインで利用中' : 'オフラインの準備は完了していません'}</span>
      {installable && !installed && <button onClick={() => void install()}>アプリをインストール</button>}
      <details><summary>アプリ・更新について</summary><div className="pwa-help">
        <p>{installed ? 'アプリとして利用中です。' : 'Chrome・Edgeのメニューで「アプリをインストール」、対応するモバイルブラウザでは「ホーム画面に追加」を選べます。項目名はブラウザにより異なります。'}</p>
        <p>準備完了後は、回路図の編集とJSON・SVG・PNGの保存、印刷用画面をオフラインで利用できます。PDF保存はブラウザの印刷機能を使います。端末のフォントや印刷機能により表示が異なる場合があります。</p>
        <p>図は端末内に保存されます。ブラウザのデータ削除に備え、大切な図は「JSON保存」でファイルにも保存してください。</p>
        <button disabled={!online || checking || !registration.current} onClick={() => void check()}>{checking ? '確認中…' : '更新を確認'}</button>
      </div></details>
    </div>
    {message && <p className="pwa-message" aria-live="polite">{message}</p>}
    {waiting && <p className="pwa-update" aria-live="polite">新しい版の準備ができました。編集中の図を「JSON保存」して、回路図スタジオのすべてのタブ・アプリ画面を閉じて開き直すと更新されます。</p>}
  </section>
}

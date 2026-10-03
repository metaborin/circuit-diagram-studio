import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, CircuitBoard, Copy, Download, FileJson, FolderOpen, Grid2X2, Maximize2, Minus, MousePointer2, Plus, Redo2, RotateCw, Save, Trash2, Undo2, Workflow, X, Zap } from 'lucide-react'
import type { Anchor, Annotation, CircuitComponent, CircuitDocument, ComponentKind, Point, Selection } from './types'
import { anchorKey, blankDocument, createComponent, deleteSelection, getExportIssues, getWarnings, resolveAnchor, snap, splitWire, uid, validateDocument, wirePoints } from './model'
import { templates } from './templates'
import { CircuitSvg } from './CircuitSvg'
import { downloadJson, downloadPng, downloadSvg, printDiagram } from './export'

type Tool = 'select' | 'wire' | 'junction' | 'terminal' | 'text' | 'current' | 'voltage' | ComponentKind
type History = { past: CircuitDocument[]; present: CircuitDocument; future: CircuitDocument[] }
const STORAGE_KEY = 'circuit-diagram-studio:v1'
const parts: { kind: ComponentKind; name: string; mark: string }[] = [
  { kind: 'resistor', name: '抵抗', mark: 'R' }, { kind: 'inductor', name: 'コイル', mark: 'L' }, { kind: 'capacitor', name: 'コンデンサ', mark: 'C' },
  { kind: 'battery', name: '電池', mark: '▏│' }, { kind: 'dc', name: '直流電源', mark: '⎓' }, { kind: 'ac', name: '交流電源', mark: '∿' },
  { kind: 'switch', name: 'スイッチ', mark: 'S' }, { kind: 'ammeter', name: '電流計', mark: 'Ⓐ' }, { kind: 'voltmeter', name: '電圧計', mark: 'Ⓥ' },
]
const clone = <T,>(x: T): T => structuredClone(x)
function initialDocument(): CircuitDocument {
  try { const data = localStorage.getItem(STORAGE_KEY); if (data) return validateDocument(JSON.parse(data)) } catch { /* A damaged local draft never prevents opening the editor. */ }
  return templates.find(t => t.id === 'resistor-series')?.create() ?? templates[0].create()
}
const describeTool = (tool: Tool, wiring: boolean) => tool === 'wire' ? wiring ? '次の端子・接続点・配線をクリック。空白をクリックすると中継点を追加。Esc で終了。' : '始点の端子・接続点・配線をクリックしてください。空白からも始められます。' : tool === 'select' ? '部品をドラッグで移動。クリックで数値・ラベルを編集できます。' : '図上をクリックして配置します。Esc で選択ツールに戻ります。'

export default function App() {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: initialDocument(), future: [] }))
  const doc = history.present
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [tab, setTab] = useState<'parts' | 'templates'>('parts')
  const [wireStart, setWireStart] = useState<Anchor | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [grid, setGrid] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [help, setHelp] = useState(false)
  const [notice, setNotice] = useState('編集内容はこのブラウザに自動保存されます。')
  const [storageOk, setStorageOk] = useState(true)
  const [saved, setSaved] = useState(() => {
    // A recovered local draft may never have been saved to a portable JSON file.
    try { return localStorage.getItem(STORAGE_KEY) ? '' : JSON.stringify(doc) } catch { return JSON.stringify(doc) }
  })
  const [showExport, setShowExport] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ before: CircuitDocument; selection: NonNullable<Selection>; start: Point; origin: Point; moved: boolean } | null>(null)
  const dirty = saved !== JSON.stringify(doc)
  const warnings = getWarnings(doc)
  const component = selection?.type === 'component' ? doc.components.find(c => c.id === selection.id) : undefined
  const junction = selection?.type === 'junction' ? doc.junctions.find(c => c.id === selection.id) : undefined
  const annotation = selection?.type === 'annotation' ? doc.annotations.find(c => c.id === selection.id) : undefined
  const wire = selection?.type === 'wire' ? doc.wires.find(c => c.id === selection.id) : undefined
  const commit = (next: CircuitDocument) => {
    setHistory(h => JSON.stringify(next) === JSON.stringify(h.present) ? h : ({ past: [...h.past.slice(-79), h.present], present: next, future: [] }))
  }
  const changeTool = (next: Tool) => { setTool(next); setWireStart(null); setPointer(null) }
  const undo = () => { setHistory(h => h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h); setWireStart(null); setSelection(null) }
  const redo = () => { setHistory(h => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h); setWireStart(null); setSelection(null) }
  const remove = () => { if (selection) { commit(deleteSelection(doc, selection)); setSelection(null); setWireStart(null) } }
  const patchSelected = (patch: Record<string, unknown>) => {
    if (!selection) return
    const next = clone(doc)
    const collection = selection.type === 'component' ? next.components : selection.type === 'junction' ? next.junctions : selection.type === 'annotation' ? next.annotations : next.wires
    const item = collection.find(c => c.id === selection.id)
    if (item) Object.assign(item, patch)
    commit(next)
  }
  const rotate = () => { const item = component ?? annotation; if (item) patchSelected({ rotation: (item.rotation + 90) % 360 }) }
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); setStorageOk(true) }
    catch { setStorageOk(false); setNotice('このブラウザでは自動保存できません。編集内容は「JSON保存」で保存してください。') }
  }, [doc])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable=true]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (e.key === 'Escape') { changeTool('select'); setSelection(null); setHelp(false) }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
      if (e.key.toLowerCase() === 'r') rotate()
      const item = component ?? junction ?? annotation
      if (item && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault(); patchSelected({ x: Math.max(40, Math.min(1000, item.x + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0))), y: Math.max(60, Math.min(620, item.y + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0))) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const pointAt = (e: ReactPointerEvent<SVGSVGElement>): Point => {
    const matrix = e.currentTarget.getScreenCTM()
    const p = matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()) : new DOMPoint()
    return { x: Math.max(40, Math.min(1000, snap(p.x))), y: Math.max(60, Math.min(620, snap(p.y))) }
  }
  const hitAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const target = (e.target as Element).closest('[data-type]') as SVGElement | null
    return target ? { type: target.dataset.type!, id: target.dataset.id!, port: Number(target.dataset.port) as 0 | 1 } : null
  }
  const anchorAt = (p: Point, hit: ReturnType<typeof hitAt>, source: CircuitDocument): { next: CircuitDocument; anchor: Anchor; existing: boolean } => {
    if (hit?.type === 'port') return { next: source, anchor: { type: 'component', id: hit.id, port: hit.port }, existing: true }
    if (hit?.type === 'junction') return { next: source, anchor: { type: 'junction', id: hit.id }, existing: true }
    // Geometric tolerance only resolves an explicit pointer action; it never auto-connects a move.
    for (const c of source.components) for (const port of [0,1] as const) {
      const a: Anchor = { type: 'component', id: c.id, port }; const q = resolveAnchor(source,a)
      if (q && Math.hypot(q.x-p.x,q.y-p.y)<12) return { next: source, anchor:a, existing:true }
    }
    if (hit?.type === 'wire') { const split = splitWire(source,hit.id,p); if (split) return { next:split.doc, anchor:split.anchor, existing:true } }
    const old = source.junctions.find(j => j.x === p.x && j.y === p.y)
    if (old) return { next:source, anchor:{type:'junction',id:old.id}, existing:true }
    const next = clone(source); const id = uid('j'); next.junctions.push({id,...p,label:'',terminal:false})
    return { next, anchor:{type:'junction',id}, existing:false }
  }
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = pointAt(e); const hit = hitAt(e)
    if (tool === 'wire') {
      const found = anchorAt(p,hit,doc)
      if (!wireStart) { if (found.next !== doc) commit(found.next); setWireStart(found.anchor); setPointer(p); return }
      if (anchorKey(wireStart) === anchorKey(found.anchor)) { setWireStart(null); return }
      const next = clone(found.next)
      if (!next.wires.some(w => (anchorKey(w.from)===anchorKey(wireStart)&&anchorKey(w.to)===anchorKey(found.anchor))||(anchorKey(w.to)===anchorKey(wireStart)&&anchorKey(w.from)===anchorKey(found.anchor)))) next.wires.push({id:uid('w'),from:wireStart,to:found.anchor,route:'hv'})
      commit(next); setWireStart(found.existing ? null : found.anchor); setNotice(found.existing ? '配線しました。次の始点を選べます。' : '中継点を追加しました。続けて配線できます。'); return
    }
    if (tool === 'junction' || tool === 'terminal') {
      const found = anchorAt(p,hit,doc); const next = clone(found.next)
      if (found.anchor.type === 'junction') { const j = next.junctions.find(j=>j.id===found.anchor.id)!; j.terminal = tool === 'terminal'; if (j.terminal && !j.label) j.label = 'A'; commit(next); setSelection({type:'junction',id:j.id}) }
      else setNotice('部品端子からの分岐は「配線」で追加できます。')
      changeTool('select'); return
    }
    if (parts.some(c=>c.kind===tool)) {
      const next = clone(doc); const c = createComponent(tool as ComponentKind,p.x,p.y)
      const prefix = c.label.replace(/[_₀-₉0-9]/g,'')
      c.label = `${prefix || 'R'}_${1 + doc.components.filter(x=>x.kind===c.kind).length}`
      next.components.push(c); commit(next); setSelection({type:'component',id:c.id}); changeTool('select'); return
    }
    if (tool === 'text' || tool === 'current' || tool === 'voltage') {
      const next = clone(doc); const a: Annotation = { id:uid('a'),kind:tool,...p,rotation:0,text:tool==='text'?'注記':tool==='current'?'I':'U' }
      next.annotations.push(a); commit(next); setSelection({type:'annotation',id:a.id}); changeTool('select'); return
    }
    if (!hit) { setSelection(null); return }
    const selected: NonNullable<Selection> = {type:(hit.type==='port'?'component':hit.type) as NonNullable<Selection>['type'],id:hit.id}
    setSelection(selected)
    const item = selected.type==='component'?doc.components.find(x=>x.id===selected.id):selected.type==='junction'?doc.junctions.find(x=>x.id===selected.id):selected.type==='annotation'?doc.annotations.find(x=>x.id===selected.id):undefined
    if (item) { drag.current={before:clone(doc),selection:selected,start:p,origin:{x:item.x,y:item.y},moved:false}; e.currentTarget.setPointerCapture(e.pointerId) }
  }
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p=pointAt(e); if (wireStart) setPointer(p)
    const d=drag.current; if(!d) return
    const dx=p.x-d.start.x,dy=p.y-d.start.y; if(!dx&&!dy&&!d.moved) return
    d.moved=true; const next=clone(d.before)
    const item=(d.selection.type==='component'?next.components:d.selection.type==='junction'?next.junctions:next.annotations).find(x=>x.id===d.selection.id)!
    item.x=Math.max(40,Math.min(1000,d.origin.x+dx));item.y=Math.max(60,Math.min(620,d.origin.y+dy))
    setHistory(h=>({...h,present:next}))
  }
  const onUp = () => {
    const d=drag.current;drag.current=null
    if(d?.moved) setHistory(h=>({past:[...h.past.slice(-79),d.before],present:h.present,future:[]}))
  }
  const replaceDocument = (next: CircuitDocument) => {
    if(dirty && !window.confirm('編集中の図を切り替えます。必要ならキャンセルして「JSON保存」をしてください。切り替え後も「元に戻す」で戻せます。')) return
    commit(next); setSelection(null); changeTool('select'); setSaved(JSON.stringify(next));setNotice('図を切り替えました。元の図には「元に戻す」で戻れます。')
  }
  const loadFile = async (file?: File) => {
    if(!file) return
    try { if(file.size>2_000_000) throw new Error('ファイルは2MB以下にしてください。'); const next=validateDocument(JSON.parse(await file.text()));replaceDocument(next) }
    catch(e) { setNotice(`読み込めませんでした：${e instanceof Error?e.message:'ファイル形式を確認してください。'}`) }
    if(fileInput.current) fileInput.current.value=''
  }
  const saveJson = () => { downloadJson(doc);setSaved(JSON.stringify(doc));setNotice('JSONを保存しました。このファイルから別の端末でも編集を再開できます。') }
  const doExport = async (format:'svg'|'png'|'print') => {
    const issues = getExportIssues(doc)
    if (issues.length) { setNotice(`接続が紛らわしい配置のため出力を停止しました：${issues[0]} 配線の通過点や部品位置を調整してください。`); setShowExport(false); return }
    try { if(format==='svg') downloadSvg(doc); else if(format==='png') await downloadPng(doc,3); else printDiagram(doc);setNotice(format==='print'?'印刷用画面で「印刷 / PDF保存」を押し、送信先「PDFに保存」を選べます。':`${format.toUpperCase()}を書き出しました。図だけを白黒で出力しています。`);setShowExport(false) }
    catch(e) {setNotice(`出力できませんでした：${e instanceof Error?e.message:'もう一度お試しください。'}`)}
  }
  const previewStart=wireStart?resolveAnchor(doc,wireStart):null
  const duplicate = () => { if(!component&&!annotation) return;const next=clone(doc);const item=clone((component??annotation)!);item.id=uid(component?'c':'a');item.x=Math.min(1000,item.x+40);item.y=Math.min(620,item.y+40);if(component) next.components.push(item as CircuitComponent);else next.annotations.push(item as Annotation);commit(next);setSelection({type:component?'component':'annotation',id:item.id}) }
  const joinAtJunction = () => {
    if(!junction) return
    let next=clone(doc);let count=0
    for(const w of [...next.wires]) {
      if([w.from,w.to].some(a=>a.type==='junction'&&a.id===junction.id)) continue
      const points=wirePoints(next,w)
      if(!points.slice(1).some((p,i)=>{const a=points[i];return a.x===p.x&&junction.x===p.x&&junction.y>=Math.min(a.y,p.y)&&junction.y<=Math.max(a.y,p.y)||a.y===p.y&&junction.y===p.y&&junction.x>=Math.min(a.x,p.x)&&junction.x<=Math.max(a.x,p.x)})) continue
      const split=splitWire(next,w.id,junction)
      if(split?.anchor.type==='junction') { const removeId=split.anchor.id;next=split.doc;next.wires=next.wires.map(w=>({...w,from:w.from.type==='junction'&&w.from.id===removeId?{type:'junction',id:junction.id}:w.from,to:w.to.type==='junction'&&w.to.id===removeId?{type:'junction',id:junction.id}:w.to}));if(removeId!==junction.id) next.junctions=next.junctions.filter(j=>j.id!==removeId);count++ }
    }
    commit(next);setNotice(count?`${count}本の配線をこの接続点で結合しました。`:'この位置に結合する別の配線はありません。')
  }
  const positionFields = (item: Point) => <div className="two-fields"><label>X 座標<input aria-label="X 座標" type="number" min="40" max="1000" step="20" value={item.x} onChange={e=>patchSelected({x:Math.max(40,Math.min(1000,snap(Number(e.target.value))))})}/></label><label>Y 座標<input aria-label="Y 座標" type="number" min="60" max="620" step="20" value={item.y} onChange={e=>patchSelected({y:Math.max(60,Math.min(620,snap(Number(e.target.value))))})}/></label></div>
  return <>
    <header className="app-header"><a className="brand" href="./"><span className="brand-icon"><CircuitBoard size={24}/></span><span>回路図スタジオ<small>CIRCUIT DIAGRAM STUDIO</small></span></a><div className="header-note">電気の教材を、きれいな回路図に。</div><button className="quiet" onClick={()=>setHelp(true)}><CircleHelp size={17}/>使い方</button><a className="github-link" href="https://github.com/metaborin/circuit-diagram-studio" target="_blank" rel="noreferrer">GitHub <ArrowRight size={13}/></a></header>
    <main>
      <section className="document-bar"><div className="document-heading"><span className="eyebrow">WORKSPACE <span>高校電気科の教材づくりに</span></span><input className="title-input" aria-label="図のタイトル" value={doc.title} maxLength={80} onChange={e=>commit({...doc,title:e.target.value})}/><span className="local-badge"><span/>{storageOk ? '端末内で編集・保存' : '自動保存できません'} <span className="badge-divider">/</span> v1.0</span></div><div className="document-actions"><input ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="JSONファイルを開く" onChange={e=>void loadFile(e.target.files?.[0])}/><button onClick={()=>fileInput.current?.click()}><FolderOpen size={16}/>開く</button><button onClick={saveJson}><Save size={16}/>JSON保存</button><div className="export-wrap"><button className="primary" aria-expanded={showExport} onClick={()=>setShowExport(!showExport)}><ArrowDownToLine size={17}/>図を書き出す<ChevronDown size={14}/></button>{showExport&&<div className="export-menu"><button onClick={()=>void doExport('png')}><Download size={16}/><span>PNG画像<small>Wordに貼り付け・3倍解像度</small></span></button><button onClick={()=>void doExport('svg')}><Workflow size={16}/><span>SVG画像<small>拡大しても鮮明なベクター</small></span></button><button onClick={()=>void doExport('print')}><FileJson size={16}/><span>印刷 / PDF<small>ブラウザの「PDFに保存」を利用</small></span></button></div>}</div></div></section>
      <div className="editor-layout">
        <aside className="library-panel"><div className="panel-tabs"><button className={tab==='parts'?'active':''} onClick={()=>setTab('parts')}>部品</button><button className={tab==='templates'?'active':''} onClick={()=>setTab('templates')}>ひな形</button></div>{tab==='parts'?<><div className="panel-section-heading">回路部品 <span>クリックして配置</span></div><div className="parts-grid">{parts.map(p=><button key={p.kind} className={`part-button ${tool===p.kind?'active':''}`} onClick={()=>changeTool(p.kind)} title={`${p.name}を追加`}><span className="part-symbol">{p.mark}</span><span>{p.name}</span></button>)}</div><div className="panel-section-heading">接続・注記</div><div className="utility-list">{([{id:'junction',mark:'●',name:'接続点'},{id:'terminal',mark:'○',name:'端子'},{id:'text',mark:'T',name:'テキスト'},{id:'current',mark:'→',name:'電流矢印'},{id:'voltage',mark:'+ −',name:'電圧・極性'}] as const).map(x=><button className={tool===x.id?'active':''} key={x.id} onClick={()=>changeTool(x.id)}><span>{x.mark}</span>{x.name}<Plus size={13}/></button>)}</div><div className="library-tip"><Zap size={17}/><p>ひな形から、すぐに。<small>直並列・RLC・ブリッジなど、授業で使う基本回路を用意しました。</small></p><button onClick={()=>setTab('templates')}>ひな形を見る <ArrowRight size={14}/></button></div></>:<><div className="panel-section-heading">回路のひな形 <span>{templates.length}種類</span></div><div className="template-list">{templates.map(t=><button key={t.id} data-testid={`template-${t.id}`} onClick={()=>replaceDocument(t.create())}><small>{t.category}</small><strong>{t.name}</strong><span>{t.description}</span></button>)}</div></>}<button className="new-document" onClick={()=>{if(window.confirm('新しい空白の図にしますか？現在の図は「元に戻す」で復元できます。必要なら先にJSON保存してください。')){commit(blankDocument());setSelection(null);changeTool('select')}}}><Plus size={15}/>空白の図を作成</button></aside>
        <section className="canvas-panel" aria-label="回路図編集エリア"><div className="canvas-toolbar"><div className="tool-group"><button title="選択・移動 (Esc)" aria-label="選択・移動" className={tool==='select'?'active':''} onClick={()=>changeTool('select')}><MousePointer2 size={17}/><span>選択</span></button><button title="端子・接続点から配線" aria-label="配線" className={tool==='wire'?'active':''} onClick={()=>changeTool('wire')}><Workflow size={17}/><span>配線</span></button></div><span className="toolbar-separator"/><button title="元に戻す (Ctrl+Z)" aria-label="元に戻す" disabled={!history.past.length} onClick={undo}><Undo2 size={17}/></button><button title="やり直す (Ctrl+Y)" aria-label="やり直す" disabled={!history.future.length} onClick={redo}><Redo2 size={17}/></button><div className="toolbar-spacer"/><button title="グリッド表示" aria-label="グリッド表示" aria-pressed={grid} className={grid?'on':''} onClick={()=>setGrid(!grid)}><Grid2X2 size={16}/></button><span className="toolbar-separator"/><button aria-label="縮小" title="縮小" onClick={()=>setZoom(Math.max(.75,zoom-.25))}><Minus size={15}/></button><span className="zoom-label">{Math.round(zoom*100)}%</span><button aria-label="拡大" title="拡大" onClick={()=>setZoom(Math.min(2,zoom+.25))}><Plus size={15}/></button><button aria-label="全体表示" title="全体表示" onClick={()=>setZoom(1)}><Maximize2 size={15}/></button></div>
        <div className="canvas-caption"><span><span className="paper-dot"/>白黒の回路図</span><span>グリッド 20 · スナップ ON</span></div><div className={`canvas-scroll tool-${tool}`}><div className="paper" style={{width:zoom===1?'100%':`${zoom*100}%`,minWidth:zoom===1?560:560*zoom}}><CircuitSvg document={doc} selected={selection} showPorts grid={grid} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>{previewStart&&pointer&&<path d={`M ${previewStart.x} ${previewStart.y} H ${pointer.x} V ${pointer.y}`} fill="none" stroke="#2b7a61" strokeWidth="2" strokeDasharray="6 5" pointerEvents="none"/>}</CircuitSvg></div></div>
        <div className="canvas-hint"><MousePointer2 size={14}/><span>{describeTool(tool,!!wireStart)}</span>{wireStart&&<button onClick={()=>setWireStart(null)}>配線を終了</button>}</div><div className="canvas-status"><span>{doc.components.length} 部品 <span>·</span> {doc.wires.length} 配線</span><span><Check size={13}/> 接続は端子に追従</span></div></section>
        <aside className="properties-panel"><div className="properties-title"><span>プロパティ</span><span className="tiny-label">INSPECTOR</span></div>{selection?<><div className="selected-title"><span>{component?parts.find(p=>p.kind===component.kind)?.name:junction?junction.terminal?'端子':'接続点':wire?'配線':'注記'}</span><div>{(component||annotation)&&<><button title="複製" aria-label="複製" onClick={duplicate}><Copy size={15}/></button><button title="90°回転 (R)" aria-label="90°回転" onClick={rotate}><RotateCw size={15}/></button></>}<button title="削除 (Delete)" aria-label="削除" onClick={remove}><Trash2 size={15}/></button></div></div>
          {component&&<div className="property-fields"><label>記号<input value={component.label} aria-label="記号" maxLength={80} placeholder="R_1" onChange={e=>patchSelected({label:e.target.value})}/><small>R_1 → R₁ のように添字で表示</small></label><div className="two-fields"><label>値<input value={component.value} aria-label="値" maxLength={80} placeholder="10" onChange={e=>patchSelected({value:e.target.value})}/></label><label>単位<input value={component.unit} aria-label="単位" maxLength={40} placeholder="Ω" list="units" onChange={e=>patchSelected({unit:e.target.value})}/></label></div><label>補足ラベル<input value={component.detail} aria-label="補足ラベル" maxLength={100} placeholder="50 Hz / ∠30° / 実効値" onChange={e=>patchSelected({detail:e.target.value})}/></label><label>問題用の表示<select value={component.labelMode} aria-label="問題用の表示" onChange={e=>patchSelected({labelMode:e.target.value})}><option value="show">記号・値・単位を表示</option><option value="question">値を ? にする</option><option value="blank">値を空欄にする</option><option value="hidden">ラベルをすべて非表示</option></select></label>{component.kind==='switch'&&<label className="checkbox-label"><input type="checkbox" checked={!!component.closed} onChange={e=>patchSelected({closed:e.target.checked})}/>スイッチを閉じる</label>}<div className="field-divider"/><label>向き<select value={component.rotation} aria-label="向き" onChange={e=>patchSelected({rotation:Number(e.target.value)})}>{[0,90,180,270].map(n=><option key={n} value={n}>{n}°</option>)}</select></label>{positionFields(component)}<div className="two-fields"><label>ラベル X<input aria-label="ラベル X" type="number" min="-400" max="400" step="10" value={component.labelDx} onChange={e=>patchSelected({labelDx:Math.max(-400,Math.min(400,Number(e.target.value)))})}/></label><label>ラベル Y<input aria-label="ラベル Y" type="number" min="-400" max="400" step="10" value={component.labelDy} onChange={e=>patchSelected({labelDy:Math.max(-400,Math.min(400,Number(e.target.value)))})}/></label></div><p className="field-note">文字が重なったときは、ラベル X・Y で位置を調整できます。</p></div>}
          {junction&&<div className="property-fields"><label>端子名<input aria-label="端子名" value={junction.label} maxLength={60} onChange={e=>patchSelected({label:e.target.value})}/></label><label className="checkbox-label"><input type="checkbox" checked={junction.terminal} onChange={e=>patchSelected({terminal:e.target.checked})}/>白丸の端子として表示</label>{positionFields(junction)}<button className="wide-button" onClick={joinAtJunction}>この位置の配線を結合</button><p className="field-note">交差している別の配線も、この接続点へ明示的に接続します。結合前は交差しても接続しません。</p></div>}
          {annotation&&<div className="property-fields"><label>表示テキスト<input aria-label="表示テキスト" value={annotation.text} maxLength={160} onChange={e=>patchSelected({text:e.target.value})}/></label><label>向き<select aria-label="向き" value={annotation.rotation} onChange={e=>patchSelected({rotation:Number(e.target.value)})}>{[0,90,180,270].map(n=><option key={n}>{n}</option>)}</select></label>{positionFields(annotation)}<p className="field-note">注記は独立した図形です。部品を移動したときは矢印の位置・向きも確認してください。</p></div>}
          {wire&&<div className="property-fields"><label>配線の曲がり方<select aria-label="配線の曲がり方" value={wire.route} onChange={e=>patchSelected({route:e.target.value})}><option value="hv">横 → 縦</option><option value="vh">縦 → 横</option></select></label><p className="field-note">端点は接続先に追従します。端点を変更する場合は、この配線を削除して引き直します。</p><label>通過点</label>{(wire.via??[]).map((p,i)=><div className="via-row" key={i}><input aria-label={`通過点${i+1} X`} type="number" step="20" value={p.x} onChange={e=>patchSelected({via:wire.via!.map((v,j)=>i===j?{...v,x:Math.max(40,Math.min(1000,snap(Number(e.target.value))))}:v)})}/><input aria-label={`通過点${i+1} Y`} type="number" step="20" value={p.y} onChange={e=>patchSelected({via:wire.via!.map((v,j)=>i===j?{...v,y:Math.max(60,Math.min(620,snap(Number(e.target.value))))}:v)})}/><button aria-label={`通過点${i+1}を削除`} onClick={()=>patchSelected({via:wire.via!.filter((_,j)=>j!==i)})}><X size={14}/></button></div>)}<button onClick={()=>patchSelected({via:[...(wire.via??[]),{x:520,y:340}]})}><Plus size={14}/>通過点を追加</button></div>}
        </>:<div className="empty-inspector"><MousePointer2 size={26}/><strong>図の中の部品を選択</strong><p>値や記号、向きなどを<br/>ここで編集できます。</p><div className="shortcut-grid"><span>移動</span><kbd>ドラッグ / 矢印キー</kbd><span>回転</span><kbd>R</kbd><span>削除</span><kbd>Delete</kbd></div></div>}
        <div className="output-settings"><div className="panel-section-heading">図の設定</div><label>抵抗の記号<select aria-label="抵抗の記号" value={doc.settings.resistorStyle} onChange={e=>commit({...doc,settings:{...doc.settings,resistorStyle:e.target.value as 'iec'|'zigzag'}})}><option value="iec">長方形（IEC）</option><option value="zigzag">ジグザグ</option></select></label><label>出力の余白<select aria-label="出力の余白" value={doc.settings.margin} onChange={e=>commit({...doc,settings:{...doc.settings,margin:Number(e.target.value)}})}><option value="20">小さめ · 20</option><option value="40">標準 · 40</option><option value="80">広め · 80</option></select></label><label className="checkbox-label"><input type="checkbox" checked={doc.settings.showTitle} onChange={e=>commit({...doc,settings:{...doc.settings,showTitle:e.target.checked}})}/>タイトルも書き出す</label></div></aside>
      </div>
      <div className="below-editor"><div role="status" aria-live="polite"><span className="status-dot"/>{notice}</div><button className="quiet" onClick={()=>setHelp(true)}>接続と出力について <CircleHelp size={14}/></button></div>{warnings.length>0&&<details className="warnings"><summary>接続・配置の確認メモ（{warnings.length}件）</summary><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p>計算や回路の正誤を判定するものではありません。出題前に図を確認してください。</p></details>}
      <footer><span>高校範囲の基本回路を作図するツール。回路計算・シミュレーション機能はありません。</span><span>データは端末内 · ログイン不要 · 無料</span></footer>
    </main>
    <datalist id="units">{['Ω','kΩ','MΩ','H','mH','μH','F','μF','nF','pF','V','V RMS','A','mA','Hz','kHz'].map(u=><option key={u}>{u}</option>)}</datalist>
    {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="使い方" onClick={e=>e.stopPropagation()}><div className="help-header"><div><span className="eyebrow">QUICK GUIDE</span><h2>授業に使える回路図を、手軽に。</h2></div><button aria-label="使い方を閉じる" onClick={()=>setHelp(false)}><X size={20}/></button></div><ol><li><strong>ひな形を選ぶ、または部品を置く</strong><p>左の部品を選んで図上をクリック。ドラッグや座標入力で移動でき、R キーで90°回転できます。</p></li><li><strong>端子から端子へ配線する</strong><p>「配線」を選び、青緑の端子を順番にクリック。配線の途中をクリックすると分岐点を作れます。空白クリックで中継点を追加し、Escで終了。選択した配線には通過点も追加できます。</p></li><li><strong>数値・記号・問題用の表示を整える</strong><p>R_1 の添字、Ω・μF・mH・∠30°などに対応。値を ? や空欄にできます。交流の実効値・最大値は自動判断しないため、単位や補足に明記してください。</p></li><li><strong>保存して教材へ</strong><p>JSON保存で編集データを持ち運べます。PNGは白背景・3倍解像度、SVGはベクター。印刷用画面からPDF保存ができます。グリッド・選択枠・端子ガイドは出力されません。</p></li></ol><div className="help-callout"><strong>線の交差と接続について</strong><p>線が交差しただけでは接続しません。非接続交差は隙間で示します。接続点は黒丸です。交差を接続したい場合は配線上に接続点を置き、選択して「この位置の配線を結合」を押してください。部品の見た目を線に重ねるだけではつながりません。</p></div><p className="help-limit">初版の範囲：二端子の集中定数回路を中心に作図できます。変圧器・半導体・三相専用記号・自動配線の障害物回避は未対応です。電流・電圧の注記は部品と独立しています。ラベルが重なる場合は位置を調整してください。ブラウザの保存領域を削除すると自動保存も消えるため、大切な図はJSONで保存してください。</p><button className="primary" onClick={()=>setHelp(false)}>編集をはじめる <ArrowRight size={16}/></button></section></div>}
  </>
}

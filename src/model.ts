import type { Anchor, CircuitComponent, CircuitDocument, ComponentKind, Point, Selection, Wire } from './types'

export const GRID = 20
export const snap = (n: number): number => Math.round(n / GRID) * GRID
export const uid = (prefix = 'item'): string => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

export function blankDocument(): CircuitDocument {
  return { version: 1, title: '新しい回路図', components: [], junctions: [], wires: [], annotations: [], settings: { resistorStyle: 'iec', margin: 40, showTitle: true } }
}

const defaults: Record<ComponentKind, [string, string, string]> = {
  resistor: ['R', '10', 'Ω'], inductor: ['L', '100', 'mH'], capacitor: ['C', '10', 'μF'],
  battery: ['E', '12', 'V'], dc: ['E', '12', 'V'], ac: ['E', '100', 'V'],
  switch: ['S', '', ''], ammeter: ['A', '', ''], voltmeter: ['V', '', ''],
}

export function createComponent(kind: ComponentKind, x: number, y: number): CircuitComponent {
  const [label, value, unit] = defaults[kind]
  return { id: uid('c'), kind, x: snap(x), y: snap(y), rotation: 0, label, value, unit,
    detail: kind === 'ac' ? '50 Hz / RMS' : '', labelMode: 'show', labelDx: 0, labelDy: kind === 'ac' ? -76 : -48,
    ...(kind === 'switch' ? { closed: false } : {}) }
}

export const anchorKey = (anchor: Anchor): string => anchor.type === 'component' ? `c:${anchor.id}:${anchor.port}` : `j:${anchor.id}`

export function resolveAnchor(doc: CircuitDocument, anchor: Anchor): Point | null {
  if (anchor.type === 'junction') {
    const node = doc.junctions.find(j => j.id === anchor.id)
    return node ? { x: node.x, y: node.y } : null
  }
  const c = doc.components.find(component => component.id === anchor.id)
  if (!c) return null
  const offset = anchor.port === 0 ? -40 : 40
  const vector: Record<number, Point> = { 0: { x: offset, y: 0 }, 90: { x: 0, y: offset }, 180: { x: -offset, y: 0 }, 270: { x: 0, y: -offset } }
  return { x: c.x + vector[c.rotation].x, y: c.y + vector[c.rotation].y }
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Route from actual anchors every render. Via points are fixed routing controls, never electrical nodes. */
export function wirePoints(doc: CircuitDocument, wire: Wire): Point[] {
  const from = resolveAnchor(doc, wire.from)
  const to = resolveAnchor(doc, wire.to)
  if (!from || !to) return []
  const result: Point[] = [from]
  for (const target of [...(wire.via ?? []), to]) {
    const previous = result[result.length - 1]
    if (previous.x !== target.x && previous.y !== target.y) {
      result.push(wire.route === 'hv' ? { x: target.x, y: previous.y } : { x: previous.x, y: target.y })
    }
    if (!samePoint(result[result.length - 1], target)) result.push({ ...target })
  }
  // Keep bends but remove collinear intermediates. Never discard a backtracking bend.
  for (let i = result.length - 2; i > 0; i--) {
    const a = result[i - 1], b = result[i], c = result[i + 1]
    const vertical = a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) >= 0
    const horizontal = a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) >= 0
    if (vertical || horizontal) result.splice(i, 1)
  }
  return result
}

export function deleteSelection(doc: CircuitDocument, selection: Selection): CircuitDocument {
  if (!selection) return doc
  const removedAnchorType = selection.type === 'component' || selection.type === 'junction' ? selection.type : null
  return { ...doc,
    components: doc.components.filter(c => selection.type !== 'component' || c.id !== selection.id),
    junctions: doc.junctions.filter(j => selection.type !== 'junction' || j.id !== selection.id),
    annotations: doc.annotations.filter(a => selection.type !== 'annotation' || a.id !== selection.id),
    wires: doc.wires.filter(w => !(selection.type === 'wire' && w.id === selection.id) &&
      !(removedAnchorType && [w.from, w.to].some(a => a.type === removedAnchorType && a.id === selection.id))),
  }
}

/** Split only the selected wire; any geometrically crossing wire remains electrically independent. */
export function splitWire(doc: CircuitDocument, wireId: string, point: Point): { doc: CircuitDocument; anchor: Anchor } | null {
  const wire = doc.wires.find(w => w.id === wireId)
  if (!wire) return null
  const points = wirePoints(doc, wire)
  if (points.length < 2) return null
  let nearest: { point: Point; segment: number; distance: number } | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const projected = a.x === b.x
      ? { x: a.x, y: Math.min(Math.max(snap(point.y), Math.min(a.y, b.y)), Math.max(a.y, b.y)) }
      : { x: Math.min(Math.max(snap(point.x), Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: a.y }
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
    if (!nearest || distance < nearest.distance) nearest = { point: projected, segment: i, distance }
  }
  if (!nearest || nearest.distance > 16) return null
  if (samePoint(nearest.point, points[0])) return { doc, anchor: wire.from }
  if (samePoint(nearest.point, points[points.length - 1])) return { doc, anchor: wire.to }
  const junction = { id: uid('j'), ...nearest.point, label: '', terminal: false }
  const anchor: Anchor = { type: 'junction', id: junction.id }
  const before = points.slice(1, nearest.segment + 1).filter(p => !samePoint(p, nearest.point))
  const after = points.slice(nearest.segment + 1, -1).filter(p => !samePoint(p, nearest.point))
  const first: Wire = { ...wire, to: anchor, via: before }
  const second: Wire = { id: uid('w'), from: anchor, to: wire.to, route: wire.route, via: after }
  return { doc: { ...doc, junctions: [...doc.junctions, junction], wires: doc.wires.flatMap(w => w.id === wire.id ? [first, second] : [w]) }, anchor }
}

/** Explicit editor action only. Coincident junctions are otherwise always separate. */
export function mergeJunctions(doc: CircuitDocument, keepId: string, removeId: string): CircuitDocument {
  if (keepId === removeId || !doc.junctions.some(j => j.id === keepId) || !doc.junctions.some(j => j.id === removeId)) return doc
  const replace = (a: Anchor): Anchor => a.type === 'junction' && a.id === removeId ? { type: 'junction', id: keepId } : a
  return { ...doc, junctions: doc.junctions.filter(j => j.id !== removeId),
    wires: doc.wires.map(w => ({ ...w, from: replace(w.from), to: replace(w.to) })).filter(w => anchorKey(w.from) !== anchorKey(w.to)) }
}

/** Wire nets only: components do not short their two ports, even when their coordinates coincide. */
export function electricalNets(doc: CircuitDocument): Anchor[][] {
  const anchors: Anchor[] = [...doc.components.flatMap(c => ([{ type: 'component', id: c.id, port: 0 }, { type: 'component', id: c.id, port: 1 }] as Anchor[])), ...doc.junctions.map(j => ({ type: 'junction', id: j.id } as Anchor))]
  const parents = new Map(anchors.map(a => [anchorKey(a), anchorKey(a)]))
  const root = (key: string): string => {
    const parent = parents.get(key)
    if (!parent || parent === key) return key
    const found = root(parent); parents.set(key, found); return found
  }
  for (const wire of doc.wires) {
    const a = anchorKey(wire.from), b = anchorKey(wire.to)
    if (parents.has(a) && parents.has(b)) parents.set(root(a), root(b))
  }
  const nets = new Map<string, Anchor[]>()
  for (const anchor of anchors) { const key = root(anchorKey(anchor)); nets.set(key, [...(nets.get(key) ?? []), anchor]) }
  return [...nets.values()]
}

type RoutedSegment = { from: Point; to: Point; net: number; wireId: string; start: number; end: number }

/** Misleading geometry only. Ordinary open circuits and separated crossing wires are valid drawings. */
export function getExportIssues(doc: CircuitDocument): string[] {
  const issues = new Set<string>()
  const netIds = new Map<string, number>()
  electricalNets(doc).forEach((net, index) => net.forEach(anchor => netIds.set(anchorKey(anchor), index)))
  const groups = new Map<string, RoutedSegment[]>()
  const segments: RoutedSegment[] = []
  const addIssue = (message: string) => { if (issues.size < 12) issues.add(message) }
  for (const wire of doc.wires) {
    const points = wirePoints(doc, wire)
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1], to = points[i]
      if (samePoint(from, to)) continue
      const horizontal = from.y === to.y
      const segment = { from, to, net: netIds.get(anchorKey(wire.from)) ?? -1, wireId: wire.id,
        start: Math.min(horizontal ? from.x : from.y, horizontal ? to.x : to.y),
        end: Math.max(horizontal ? from.x : from.y, horizontal ? to.x : to.y) }
      const key = horizontal ? `h:${from.y}` : `v:${from.x}`
      const group = groups.get(key) ?? []; group.push(segment); groups.set(key, group); segments.push(segment)
    }
  }
  // Two longest previous intervals from distinct nets suffice to detect any foreign overlap.
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start)
    let longest: RoutedSegment | undefined, other: RoutedSegment | undefined
    for (const segment of group) {
      const candidate = longest?.net === segment.net ? other : longest
      if (candidate && candidate.end >= segment.start) {
        addIssue('別の接続網の配線が同一直線上で重なるか接触しています。配線位置を離すか、接続点で明示的に結合してください。')
      }
      if (!longest) longest = segment
      else if (longest.net === segment.net) { if (segment.end > longest.end) longest = segment }
      else if (segment.end > longest.end) { other = longest; longest = segment }
      else if (!other || segment.end > other.end) other = segment
    }
  }
  const anchors: { point: Point; net: number; name: string }[] = []
  for (const c of doc.components) for (const port of [0, 1] as const) {
    const anchor: Anchor = { type: 'component', id: c.id, port }
    anchors.push({ point: resolveAnchor(doc, anchor)!, net: netIds.get(anchorKey(anchor))!, name: `${c.label || '部品'} の端子` })
  }
  for (const j of doc.junctions) {
    const anchor: Anchor = { type: 'junction', id: j.id }
    anchors.push({ point: { x: j.x, y: j.y }, net: netIds.get(anchorKey(anchor))!, name: j.label || '接続点' })
  }
  const positions = new Map<string, typeof anchors[number]>()
  for (const anchor of anchors) {
    const key = `${anchor.point.x},${anchor.point.y}`, existing = positions.get(key)
    if (existing && existing.net !== anchor.net) addIssue(`${anchor.name} が未接続の別の端子・接続点と重なっています。離すか配線で接続してください。`)
    else if (!existing) positions.set(key, anchor)
    const horizontal = groups.get(`h:${anchor.point.y}`) ?? [], vertical = groups.get(`v:${anchor.point.x}`) ?? []
    if (horizontal.some(s => s.net !== anchor.net && s.start <= anchor.point.x && anchor.point.x <= s.end) ||
      vertical.some(s => s.net !== anchor.net && s.start <= anchor.point.y && anchor.point.y <= s.end)) {
      addIssue(`${anchor.name} が接続されていない配線に重なっています。位置を離すか、配線ツールで明示的に接続してください。`)
    }
  }
  const local = (point: Point, c: CircuitComponent): Point => {
    const x = point.x - c.x, y = point.y - c.y
    switch (c.rotation) { case 90: return { x: y, y: -x }; case 180: return { x: -x, y: -y }; case 270: return { x: -y, y: x }; default: return { x, y } }
  }
  for (const c of doc.components) {
    const circular = ['dc', 'ac', 'ammeter', 'voltmeter'].includes(c.kind)
    const body: [number, number, number, number] = c.kind === 'resistor' ? [-24, -10, 24, 10]
      : c.kind === 'capacitor' ? [-6, -20, 6, 20] : c.kind === 'battery' ? [-7, -22, 7, 22]
      : c.kind === 'inductor' ? [-24, -14, 24, 2] : c.kind === 'switch' ? [-20, -20, 20, 4] : [-24, -24, 24, 24]
    const throughBody = segments.some(s => {
      if (Math.max(s.from.x, s.to.x) < c.x - 25 || Math.min(s.from.x, s.to.x) > c.x + 25 || Math.max(s.from.y, s.to.y) < c.y - 25 || Math.min(s.from.y, s.to.y) > c.y + 25) return false
      const a = local(s.from, c), b = local(s.to, c)
      if (circular) {
        const x = Math.max(Math.min(a.x, b.x), Math.min(0, Math.max(a.x, b.x)))
        const y = Math.max(Math.min(a.y, b.y), Math.min(0, Math.max(a.y, b.y)))
        return Math.hypot(x, y) < 23
      }
      return a.y === b.y
        ? a.y > body[1] && a.y < body[3] && Math.max(Math.min(a.x, b.x), body[0]) < Math.min(Math.max(a.x, b.x), body[2])
        : a.x > body[0] && a.x < body[2] && Math.max(Math.min(a.y, b.y), body[1]) < Math.min(Math.max(a.y, b.y), body[3])
    })
    if (throughBody) addIssue(`${c.label || '部品'} の本体内を配線が通っています。配線の曲がり方・経由点または部品位置を調整してください。`)
  }
  return [...issues]
}

export function getWarnings(doc: CircuitDocument): string[] {
  const warnings: string[] = getExportIssues(doc)
  const degrees = new Map<string, number>()
  for (const w of doc.wires) for (const a of [w.from, w.to]) degrees.set(anchorKey(a), (degrees.get(anchorKey(a)) ?? 0) + 1)
  for (const c of doc.components) {
    const unused = ([0, 1] as const).filter(port => !degrees.get(anchorKey({ type: 'component', id: c.id, port }))).length
    if (unused) warnings.push(`${c.label || '部品'}：未接続の端子が ${unused} 個あります。`)
  }
  for (const j of doc.junctions) if (!j.terminal && (degrees.get(anchorKey({ type: 'junction', id: j.id })) ?? 0) < 2) warnings.push(`${j.label || '接続点'}：接続された配線が 2 本未満です。`)
  for (let i = 0; i < doc.components.length; i++) for (let j = i + 1; j < doc.components.length; j++) {
    const a = doc.components[i], b = doc.components[j]
    if (Math.abs(a.x - b.x) < 60 && Math.abs(a.y - b.y) < 60) warnings.push(`${a.label || '部品'} と ${b.label || '部品'} が重なっている可能性があります。`)
  }
  return warnings
}

/** Reject malformed imports before they enter editor state; return only known, sanitized fields. */
export function validateDocument(input: unknown): CircuitDocument {
  const fail = (message: string): never => { throw new Error(`回路図 JSON が不正です：${message}`) }
  const record = (value: unknown, name: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} はオブジェクトである必要があります。`)
    return value as Record<string, unknown>
  }
  const string = (value: unknown, name: string, max = 160): string => {
    if (typeof value !== 'string' || value.length > max || [...value].some(char => {
      const code = char.charCodeAt(0)
      return code < 32 && code !== 9 && code !== 10 && code !== 13
    })) fail(`${name} の文字列が不正、または長すぎます。`)
    return value as string
  }
  const num = (value: unknown, name: string, min = -10000, max = 10000): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} は ${min}〜${max} の有限数にしてください。`)
    return value as number
  }
  const bool = (value: unknown, name: string): boolean => { if (typeof value !== 'boolean') fail(`${name} は真偽値である必要があります。`); return value as boolean }
  const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], name: string): T => {
    if (!allowed.includes(value as T)) fail(`${name} の値が未対応です。`)
    return value as T
  }
  const list = (value: unknown, name: string, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) fail(`${name} の件数が不正です（上限 ${max}）。`); return value as unknown[] }
  const point = (value: unknown): Point => { const p = record(value, '座標'); return { x: num(p.x, 'x'), y: num(p.y, 'y') } }
  const ids = new Set<string>()
  const id = (value: unknown): string => {
    const v = string(value, 'ID', 100)
    if (!/^[a-zA-Z0-9_-]+$/.test(v) || ids.has(v)) fail('ID が空、重複、または使用できない文字を含みます。')
    ids.add(v); return v
  }
  const doc = record(input, '回路図')
  if (doc.version !== 1) fail('対応する保存形式は version: 1 です。')
  const components = list(doc.components, '部品', 400).map(value => {
    const c = record(value, '部品')
    const result: CircuitComponent = { id: id(c.id), kind: oneOf(c.kind, Object.keys(defaults) as ComponentKind[], '部品種別'), ...point(c),
      rotation: oneOf(c.rotation, [0, 90, 180, 270] as const, '回転'), label: string(c.label, '記号'), value: string(c.value, '値'), unit: string(c.unit, '単位'), detail: string(c.detail, '詳細'),
      labelMode: oneOf(c.labelMode, ['show', 'question', 'blank', 'hidden'] as const, 'ラベル表示'), labelDx: num(c.labelDx, 'ラベル横位置', -2000, 2000), labelDy: num(c.labelDy, 'ラベル縦位置', -2000, 2000) }
    if (c.closed !== undefined) result.closed = bool(c.closed, 'スイッチ状態')
    return result
  })
  const junctions = list(doc.junctions, '接続点', 1000).map(value => { const j = record(value, '接続点'); return { id: id(j.id), ...point(j), label: string(j.label, '端子名'), terminal: bool(j.terminal, '端子表示') } })
  const componentIds = new Set(components.map(c => c.id)), junctionIds = new Set(junctions.map(j => j.id))
  const anchor = (value: unknown): Anchor => {
    const a = record(value, '接続先'), anchorId = string(a.id, '接続先 ID', 100)
    if (a.type === 'component') {
      if (!componentIds.has(anchorId)) fail('配線の接続先部品が存在しません。')
      return { type: 'component', id: anchorId, port: oneOf(a.port, [0, 1] as const, '端子番号') }
    }
    if (a.type === 'junction') {
      if (!junctionIds.has(anchorId)) fail('配線の接続先接続点が存在しません。')
      return { type: 'junction', id: anchorId }
    }
    return fail('配線の接続先種別が不正です。')
  }
  const wires = list(doc.wires, '配線', 2000).map(value => {
    const w = record(value, '配線'), from = anchor(w.from), to = anchor(w.to)
    if (anchorKey(from) === anchorKey(to)) fail('配線の両端を同じ端子にできません。')
    const result: Wire = { id: id(w.id), from, to, route: oneOf(w.route, ['hv', 'vh'] as const, '配線経路') }
    if (w.via !== undefined) result.via = list(w.via, '配線の経由点', 100).map(point)
    return result
  })
  const annotations = list(doc.annotations, '注記', 400).map(value => { const a = record(value, '注記'); return { id: id(a.id), ...point(a), kind: oneOf(a.kind, ['text', 'current', 'voltage'] as const, '注記種別'), rotation: oneOf(a.rotation, [0, 90, 180, 270] as const, '注記回転'), text: string(a.text, '注記本文', 500) } })
  const settings = record(doc.settings, '出力設定')
  const result: CircuitDocument = { version: 1, title: string(doc.title, '題名', 160), components, junctions, wires, annotations, settings: { resistorStyle: oneOf(settings.resistorStyle, ['iec', 'zigzag'] as const, '抵抗記号'), margin: num(settings.margin, '余白', 0, 200), showTitle: bool(settings.showTitle, '題名表示') } }
  let routeBudget = 0
  for (const wire of wires) {
    // Count even coincident endpoint wires to cap pairwise rendering overhead.
    routeBudget += Math.max(1, wirePoints(result, wire).length - 1)
    if (routeBudget > 1200) fail('配線経路が多すぎます。直線区間の合計を 1200 以下に減らしてください。')
  }
  return result
}

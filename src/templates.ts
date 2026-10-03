import { blankDocument, createComponent, uid } from './model'
import type { Anchor, CircuitComponent, CircuitDocument, ComponentKind, Point, Template } from './types'

const port = (c: CircuitComponent, index: 0 | 1): Anchor => ({ type: 'component', id: c.id, port: index })
function builder(title: string) {
  const doc = blankDocument(); doc.title = title
  const part = (kind: ComponentKind, x: number, y: number, label: string, value: string, vertical = false): CircuitComponent => {
    const c = { ...createComponent(kind, x, y), label, value,
      rotation: vertical ? 90 as const : 0 as const, labelDx: vertical ? 74 : 0, labelDy: vertical ? -12 : -48 }
    doc.components.push(c); return c
  }
  const node = (x: number, y: number, label = ''): Anchor => {
    const j = { id: uid('j'), x, y, label, terminal: false }; doc.junctions.push(j); return { type: 'junction', id: j.id }
  }
  const wire = (from: Anchor, to: Anchor, via: Point[] = [], route: 'hv' | 'vh' = 'hv') => {
    doc.wires.push({ id: uid('w'), from, to, route, ...(via.length ? { via } : {}) })
  }
  const source = (ac = false): CircuitComponent => {
    const c = part(ac ? 'ac' : 'battery', 180, 340, 'E', ac ? '100' : '12', true)
    c.labelDx = -100; c.detail = ac ? '50 Hz / RMS' : ''; return c
  }
  return { doc, part, node, wire, source }
}

function series(title: string, kinds: ComponentKind[], ac = false): CircuitDocument {
  const b = builder(title), source = b.source(ac)
  const counts: Partial<Record<ComponentKind, number>> = {}
  const symbols: Partial<Record<ComponentKind, string>> = { resistor: 'R', inductor: 'L', capacitor: 'C' }
  const positions = kinds.length === 1 ? [520] : kinds.length === 2 ? [420, 700] : [340, 560, 780]
  const parts = kinds.map((kind, index) => {
    counts[kind] = (counts[kind] ?? 0) + 1
    const multiple = kinds.filter(k => k === kind).length > 1
    return b.part(kind, positions[index], 180, `${symbols[kind]}${multiple ? ['₁', '₂', '₃'][counts[kind]! - 1] : ''}`, kind === 'inductor' ? '100' : '10')
  })
  b.wire(port(source, 0), port(parts[0], 0), [{ x: 180, y: 180 }])
  for (let i = 0; i < parts.length - 1; i++) b.wire(port(parts[i], 1), port(parts[i + 1], 0))
  b.wire(port(parts[parts.length - 1], 1), port(source, 1), [{ x: 880, y: 180 }, { x: 880, y: 500 }, { x: 180, y: 500 }])
  return b.doc
}

function parallel(title: string, kinds: ComponentKind[], ac = false): CircuitDocument {
  const b = builder(title), source = b.source(ac)
  const xs = kinds.length === 2 ? [460, 760] : [400, 620, 840]
  const tops = xs.map(x => b.node(x, 180)), bottoms = xs.map(x => b.node(x, 500))
  b.wire(port(source, 0), tops[0], [{ x: 180, y: 180 }])
  b.wire(port(source, 1), bottoms[0], [{ x: 180, y: 500 }])
  kinds.forEach((kind, i) => {
    const symbol = kind === 'resistor' ? 'R' : kind === 'inductor' ? 'L' : 'C'
    const c = b.part(kind, xs[i], 340, `${symbol}${kinds.filter(k => k === kind).length > 1 ? ['₁', '₂', '₃'][i] : ''}`, kind === 'inductor' ? '100' : '10', true)
    b.wire(tops[i], port(c, 0)); b.wire(port(c, 1), bottoms[i])
    if (i) { b.wire(tops[i - 1], tops[i]); b.wire(bottoms[i - 1], bottoms[i]) }
  })
  return b.doc
}

function mixed(ac = false): CircuitDocument {
  const b = builder(ac ? '交流 RLC 直並列回路' : '抵抗の直並列回路'), source = b.source(ac)
  const r1 = b.part('resistor', 400, 180, 'R₁', '20')
  const r2 = b.part('resistor', 600, 340, 'R₂', '30', true)
  const branch = b.part(ac ? 'inductor' : 'resistor', 840, 340, ac ? 'L' : 'R₃', ac ? '100' : '60', true)
  const top = b.node(600, 180), bottom = b.node(600, 500)
  b.wire(port(source, 0), port(r1, 0), [{ x: 180, y: 180 }]); b.wire(port(r1, 1), top)
  b.wire(top, port(r2, 0)); b.wire(port(r2, 1), bottom)
  b.wire(top, port(branch, 0), [{ x: 840, y: 180 }]); b.wire(port(branch, 1), bottom, [{ x: 840, y: 500 }])
  if (ac) {
    const capacitor = b.part('capacitor', 400, 500, 'C', '10')
    capacitor.labelDy = 46
    b.wire(bottom, port(capacitor, 1)); b.wire(port(capacitor, 0), port(source, 1), [{ x: 180, y: 500 }])
    source.detail = '50 Hz ∠30° / RMS'
  } else b.wire(bottom, port(source, 1), [{ x: 180, y: 500 }])
  return b.doc
}

function bridge(): CircuitDocument {
  const b = builder('抵抗ブリッジ回路')
  const source = b.part('battery', 160, 340, 'E', '12', true); source.labelDx = -84
  const top = b.node(420, 140, 'P'), bottom = b.node(420, 540, 'Q')
  const left = b.node(420, 340, 'A'), right = b.node(800, 340, 'B')
  const r1 = b.part('resistor', 420, 240, 'R₁', '10', true)
  const r2 = b.part('resistor', 420, 440, 'R₂', '20', true)
  const r3 = b.part('resistor', 800, 240, 'R₃', '30', true)
  const r4 = b.part('resistor', 800, 440, 'R₄', '40', true)
  r1.labelDx = -80; r2.labelDx = -80
  const r5 = b.part('resistor', 600, 340, 'R₅', '?')
  b.wire(port(source, 0), top, [{ x: 160, y: 140 }]); b.wire(port(source, 1), bottom, [{ x: 160, y: 540 }])
  b.wire(top, port(r1, 0)); b.wire(port(r1, 1), left); b.wire(left, port(r2, 0)); b.wire(port(r2, 1), bottom)
  b.wire(top, port(r3, 0), [{ x: 800, y: 140 }]); b.wire(port(r3, 1), right); b.wire(right, port(r4, 0)); b.wire(port(r4, 1), bottom, [{ x: 800, y: 540 }])
  b.wire(left, port(r5, 0)); b.wire(port(r5, 1), right)
  return b.doc
}

function measurement(): CircuitDocument {
  const b = builder('電流計・電圧計の接続'), source = b.source()
  const ammeter = b.part('ammeter', 360, 180, 'A', '')
  ammeter.labelMode = 'hidden'
  const resistor = b.part('resistor', 660, 180, 'R', '20')
  const voltmeter = b.part('voltmeter', 660, 360, 'V', '')
  voltmeter.labelMode = 'hidden'
  const left = b.node(500, 180), right = b.node(820, 180)
  b.wire(port(source, 0), port(ammeter, 0), [{ x: 180, y: 180 }]); b.wire(port(ammeter, 1), left)
  b.wire(left, port(resistor, 0)); b.wire(port(resistor, 1), right)
  b.wire(left, port(voltmeter, 0), [{ x: 500, y: 360 }]); b.wire(port(voltmeter, 1), right, [{ x: 820, y: 360 }])
  b.wire(right, port(source, 1), [{ x: 920, y: 180 }, { x: 920, y: 520 }, { x: 180, y: 520 }])
  return b.doc
}

export const templates: Template[] = [
  { id: 'dc-simple', name: '直流・抵抗 1 個', category: '直流・抵抗', description: '電池と抵抗の基本閉回路。', create: () => series('直流の基本回路', ['resistor']) },
  { id: 'resistor-series', name: '抵抗の直列', category: '直流・抵抗', description: '抵抗 2 個を直列接続。', create: () => series('抵抗の直列回路', ['resistor', 'resistor']) },
  { id: 'resistor-parallel', name: '抵抗の並列', category: '直流・抵抗', description: '抵抗 3 枝を同じ 2 節点へ接続。', create: () => parallel('抵抗の並列回路', ['resistor', 'resistor', 'resistor']) },
  { id: 'resistor-mixed', name: '抵抗の直並列', category: '直流・抵抗', description: 'R₁ と R₂ ∥ R₃ の直列接続。', create: () => mixed() },
  { id: 'resistor-bridge', name: '抵抗ブリッジ', category: '直流・抵抗', description: '左右中点間に R₅ を置いた 5 抵抗ブリッジ。', create: bridge },
  { id: 'capacitor-series', name: 'コンデンサの直列', category: 'コンデンサ', description: '電池にコンデンサ 2 個を直列接続。', create: () => series('コンデンサの直列回路', ['capacitor', 'capacitor']) },
  { id: 'capacitor-parallel', name: 'コンデンサの並列', category: 'コンデンサ', description: '電池にコンデンサ 2 個を並列接続。', create: () => parallel('コンデンサの並列回路', ['capacitor', 'capacitor']) },
  { id: 'ac-r', name: '交流・R 単独', category: '交流', description: '交流電源と抵抗。電圧は実効値と明記。', create: () => series('交流 R 回路', ['resistor'], true) },
  { id: 'ac-l', name: '交流・L 単独', category: '交流', description: '交流電源とコイル。', create: () => series('交流 L 回路', ['inductor'], true) },
  { id: 'ac-c', name: '交流・C 単独', category: '交流', description: '交流電源とコンデンサ。', create: () => series('交流 C 回路', ['capacitor'], true) },
  { id: 'ac-rc', name: '交流 RC 直列', category: '交流', description: '抵抗とコンデンサの直列接続。', create: () => series('交流 RC 直列回路', ['resistor', 'capacitor'], true) },
  { id: 'ac-rl', name: '交流 RL 直列', category: '交流', description: '抵抗とコイルの直列接続。', create: () => series('交流 RL 直列回路', ['resistor', 'inductor'], true) },
  { id: 'ac-rlc', name: '交流 RLC 直列', category: '交流', description: 'R・L・C の直列接続。', create: () => series('交流 RLC 直列回路', ['resistor', 'inductor', 'capacitor'], true) },
  { id: 'ac-parallel-rlc', name: '交流 RLC 並列', category: '交流', description: 'R・L・C の 3 枝並列接続。', create: () => parallel('交流 RLC 並列回路', ['resistor', 'inductor', 'capacitor'], true) },
  { id: 'ac-mixed', name: '交流 RLC 直並列', category: '交流', description: 'R₁ − (R₂ ∥ L) − C。電源位相を明記。', create: () => mixed(true) },
  { id: 'measurement', name: '電流計・電圧計', category: '測定', description: '電流計は直列、電圧計は抵抗に並列接続。', create: measurement },
]

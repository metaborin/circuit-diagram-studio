import { describe, expect, it } from 'vitest'
import { anchorKey, blankDocument, createComponent, deleteSelection, electricalNets, getExportIssues, getWarnings, mergeJunctions, resolveAnchor, snap, splitWire, validateDocument, wirePoints } from '../src/model'
import { templates } from '../src/templates'
import type { Anchor, CircuitDocument, Wire } from '../src/types'

function template(id: string): CircuitDocument { return templates.find(t => t.id === id)!.create() }
function netOf(doc: CircuitDocument, id: string, port: 0 | 1): number {
  return electricalNets(doc).findIndex(net => net.some(a => a.type === 'component' && a.id === id && a.port === port))
}
function assertOrthogonal(doc: CircuitDocument) {
  for (const wire of doc.wires) {
    const points = wirePoints(doc, wire)
    expect(points[0]).toEqual(resolveAnchor(doc, wire.from))
    expect(points.at(-1)).toEqual(resolveAnchor(doc, wire.to))
    for (let i = 1; i < points.length; i++) expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
  }
}

describe('sample electrical topology', () => {
  const expectedNets: Record<string, number> = {
    'dc-simple': 2, 'resistor-series': 3, 'resistor-parallel': 2, 'resistor-mixed': 3, 'resistor-bridge': 4,
    'capacitor-series': 3, 'capacitor-parallel': 2, 'ac-r': 2, 'ac-l': 2, 'ac-c': 2,
    'ac-rc': 3, 'ac-rl': 3, 'ac-rlc': 4, 'ac-parallel-rlc': 2, 'ac-mixed': 4, measurement: 3,
  }
  it.each(templates.map(t => [t.id, t.create] as const))('%s has correct nets, complete anchors and no self-shorted component', (id, create) => {
    const doc = create()
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(electricalNets(doc)).toHaveLength(expectedNets[id])
    expect(getWarnings(doc)).toEqual([])
    for (const component of doc.components) expect(netOf(doc, component.id, 0)).not.toBe(netOf(doc, component.id, 1))
    assertOrthogonal(doc)
    expect(new Set([...doc.components, ...doc.junctions, ...doc.wires, ...doc.annotations].map(a => a.id)).size)
      .toBe(doc.components.length + doc.junctions.length + doc.wires.length + doc.annotations.length)
  })

  it('parallel resistor branches share precisely the same two nets as the supply', () => {
    const doc = template('resistor-parallel'), [supply, ...resistors] = doc.components
    for (const resistor of resistors) {
      expect(netOf(doc, resistor.id, 0)).toBe(netOf(doc, supply.id, 0))
      expect(netOf(doc, resistor.id, 1)).toBe(netOf(doc, supply.id, 1))
    }
  })

  it('bridge middle nodes remain separate and R5 connects them', () => {
    const doc = template('resistor-bridge')
    const r1 = doc.components.find(c => c.label === 'R₁')!, r2 = doc.components.find(c => c.label === 'R₂')!
    const r3 = doc.components.find(c => c.label === 'R₃')!, r4 = doc.components.find(c => c.label === 'R₄')!, r5 = doc.components.find(c => c.label === 'R₅')!
    expect(netOf(doc, r1.id, 1)).toBe(netOf(doc, r2.id, 0))
    expect(netOf(doc, r3.id, 1)).toBe(netOf(doc, r4.id, 0))
    expect(netOf(doc, r5.id, 0)).toBe(netOf(doc, r1.id, 1))
    expect(netOf(doc, r5.id, 1)).toBe(netOf(doc, r3.id, 1))
    expect(netOf(doc, r1.id, 1)).not.toBe(netOf(doc, r3.id, 1))
  })

  it('AC mixed sample has E(P,0), R1(P,X), R2(X,Y), L(X,Y), C(Y,0)', () => {
    const doc = template('ac-mixed'), [source, r1, r2, inductor, capacitor] = doc.components
    const p = netOf(doc, source.id, 0), zero = netOf(doc, source.id, 1), x = netOf(doc, r1.id, 1), y = netOf(doc, r2.id, 1)
    expect(new Set([p, zero, x, y]).size).toBe(4)
    expect(netOf(doc, r1.id, 0)).toBe(p)
    expect(netOf(doc, r2.id, 0)).toBe(x)
    expect(netOf(doc, inductor.id, 0)).toBe(x)
    expect(netOf(doc, inductor.id, 1)).toBe(y)
    expect(netOf(doc, capacitor.id, 1)).toBe(y)
    expect(netOf(doc, capacitor.id, 0)).toBe(zero)
    expect(source.detail).toContain('50 Hz ∠30°')
    expect(source.detail).toContain('RMS')
    expect([inductor.value, inductor.unit]).toEqual(['100', 'mH'])
    expect([capacitor.value, capacitor.unit]).toEqual(['10', 'μF'])
  })

  it('ammeter is series-connected while voltmeter is across the resistor', () => {
    const doc = template('measurement'), [source, ammeter, resistor, voltmeter] = doc.components
    expect(netOf(doc, source.id, 0)).toBe(netOf(doc, ammeter.id, 0))
    expect(netOf(doc, ammeter.id, 1)).toBe(netOf(doc, resistor.id, 0))
    expect(netOf(doc, voltmeter.id, 0)).toBe(netOf(doc, resistor.id, 0))
    expect(netOf(doc, voltmeter.id, 1)).toBe(netOf(doc, resistor.id, 1))
  })
})

describe('anchor-preserving editing', () => {
  it('rotation and movement keep series topology with endpoints attached to actual terminals', () => {
    const original = template('resistor-series')
    const originalNets = electricalNets(original).map(net => net.map(anchorKey).sort()).sort()
    for (const rotation of [0, 90, 180, 270] as const) {
      const doc = { ...original, components: original.components.map((c, i) => i === 1 ? { ...c, x: 480, y: 260, rotation } : c) }
      expect(electricalNets(doc).map(net => net.map(anchorKey).sort()).sort()).toEqual(originalNets)
      assertOrthogonal(doc)
      const first = resolveAnchor(doc, { type: 'component', id: doc.components[1].id, port: 0 })!
      const last = resolveAnchor(doc, { type: 'component', id: doc.components[1].id, port: 1 })!
      expect(Math.hypot(first.x - last.x, first.y - last.y)).toBe(80)
    }
  })

  it('deletes incident wires together with a component without mutating the original', () => {
    const original = template('resistor-series'), id = original.components[1].id
    const next = deleteSelection(original, { type: 'component', id })
    expect(next.components).toHaveLength(2)
    expect(next.wires.every(w => w.from.id !== id && w.to.id !== id)).toBe(true)
    expect(original.components).toHaveLength(3)
    expect(getWarnings(next).length).toBeGreaterThan(0)
  })

  it('snap supports both positive and negative grid coordinates', () => {
    expect(snap(29)).toBe(20); expect(snap(31)).toBe(40); expect(snap(-31)).toBe(-40)
  })

  it('preserves all routed segments when splitting a wire with multiple bends', () => {
    const doc = template('dc-simple'), wire = doc.wires[1]
    const before = wirePoints(doc, wire)
    const result = splitWire(doc, wire.id, { x: 880, y: 321 })!
    expect(resolveAnchor(result.doc, result.anchor)).toEqual({ x: 880, y: 320 })
    const splitWires = result.doc.wires.filter(w => w.from.id === result.anchor.id || w.to.id === result.anchor.id)
    expect(splitWires).toHaveLength(2)
    const path = [wirePoints(result.doc, splitWires[0]), wirePoints(result.doc, splitWires[1])]
    for (const p of before) expect(path.flat().some(q => q.x === p.x && q.y === p.y)).toBe(true)
    expect(electricalNets(result.doc)).toHaveLength(electricalNets(doc).length)
    assertOrthogonal(result.doc)
    expect(splitWire(doc, wire.id, { x: 400, y: 300 })).toBeNull()
  })

  it('branch on an endpoint reuses the exact anchor without adding a junction', () => {
    const doc = template('dc-simple'), wire = doc.wires[0]
    const result = splitWire(doc, wire.id, resolveAnchor(doc, wire.from)!)!
    expect(result.doc).toBe(doc); expect(result.anchor).toEqual(wire.from)
  })
})

describe('crossings are not implicit connections', () => {
  function crossingCircuits(): CircuitDocument {
    const doc = blankDocument()
    const components = [createComponent('resistor', 300, 200), createComponent('battery', 300, 440), createComponent('resistor', 500, 100), createComponent('battery', 500, 540)]
    doc.components = components
    const a = (index: number, port: 0 | 1): Anchor => ({ type: 'component', id: components[index].id, port })
    const wire = (id: string, from: Anchor, to: Anchor, via: { x: number; y: number }[]): Wire => ({ id, from, to, via, route: 'hv' })
    doc.wires = [
      wire('w1', a(0, 1), a(1, 1), [{ x: 600, y: 200 }, { x: 600, y: 440 }]),
      wire('w2', a(0, 0), a(1, 0), [{ x: 100, y: 200 }, { x: 100, y: 440 }]),
      wire('w3', a(2, 0), a(3, 0), [{ x: 400, y: 100 }, { x: 400, y: 540 }]),
      wire('w4', a(2, 1), a(3, 1), [{ x: 800, y: 100 }, { x: 800, y: 540 }]),
    ]
    return doc
  }

  it('four nets remain four across crossing/splitting until an explicit join; undo restores four', () => {
    const original = crossingCircuits()
    expect(electricalNets(original)).toHaveLength(4)
    const first = splitWire(original, 'w1', { x: 400, y: 200 })!
    const second = splitWire(first.doc, 'w3', { x: 400, y: 200 })!
    expect(first.anchor.id).not.toBe(second.anchor.id)
    expect(electricalNets(second.doc)).toHaveLength(4)
    const merged = mergeJunctions(second.doc, first.anchor.id, second.anchor.id)
    expect(electricalNets(merged)).toHaveLength(3)
    expect(electricalNets(second.doc)).toHaveLength(4)
    expect(electricalNets(original)).toHaveLength(4)
    assertOrthogonal(merged)
  })

  it('components occupying the same position still have separate anchors', () => {
    const doc = blankDocument()
    doc.components = [createComponent('resistor', 400, 200), createComponent('resistor', 400, 200)]
    expect(electricalNets(doc)).toHaveLength(4)
    expect(getWarnings(doc).some(w => w.includes('重なって'))).toBe(true)
  })
})

describe('untrusted JSON import', () => {
  it.each([null, [], {}, { version: 2 }, { ...blankDocument(), components: {} }])('rejects malformed roots %j', input => {
    expect(() => validateDocument(input)).toThrow('JSON')
  })
  it('rejects infinite/NaN/out-of-bounds positions and unsupported rotations', () => {
    for (const x of [Infinity, NaN, 10001, '200', null]) {
      const doc = template('dc-simple'); (doc.components[0] as unknown as { x: unknown }).x = x
      expect(() => validateDocument(doc)).toThrow()
    }
    const doc = template('dc-simple'); (doc.components[0] as unknown as { rotation: number }).rotation = 45
    expect(() => validateDocument(doc)).toThrow()
  })
  it('rejects duplicated IDs, missing wire references and invalid ports', () => {
    let doc = template('dc-simple'); doc.components[1].id = doc.components[0].id
    expect(() => validateDocument(doc)).toThrow('ID')
    doc = template('dc-simple'); doc.wires[0].from.id = 'missing'
    expect(() => validateDocument(doc)).toThrow('存在')
    doc = template('dc-simple'); (doc.wires[0].from as unknown as { port: number }).port = 2
    expect(() => validateDocument(doc)).toThrow('端子番号')
  })
  it('rejects unreasonable arrays and text lengths', () => {
    const doc = blankDocument(); doc.components = Array.from({ length: 401 }, () => createComponent('resistor', 200, 200))
    expect(() => validateDocument(doc)).toThrow('件数')
    expect(() => validateDocument({ ...blankDocument(), title: 'x'.repeat(161) })).toThrow('長すぎ')
  })
  it('rejects excessive aggregate routed segments even when the JSON is well below 2 MB', () => {
    const doc = blankDocument()
    doc.junctions = [{ id: 'start', x: 0, y: 0, label: '', terminal: true }, { id: 'end', x: 2000, y: 400, label: '', terminal: true }]
    doc.wires = Array.from({ length: 7 }, (_, index) => ({ id: `long-${index}`, from: { type: 'junction', id: 'start' }, to: { type: 'junction', id: 'end' }, route: 'hv', via: Array.from({ length: 100 }, (_, i) => ({ x: 20 + i * 20, y: i % 2 ? 100 : 200 })) }))
    expect(JSON.stringify(doc).length).toBeLessThan(2_000_000)
    expect(() => validateDocument(doc)).toThrow('配線経路が多すぎます')
  })
  it('preserves Unicode, explicit RMS/phase, question/blank/hidden labels and drops unknown fields', () => {
    const doc = template('ac-rlc')
    doc.components[0].value = '100 V RMS'; doc.components[0].unit = ''; doc.components[0].detail = '50 Hz ∠30°'
    doc.components[1].labelMode = 'question'; doc.components[2].labelMode = 'blank'; doc.components[3].labelMode = 'hidden'
    const loaded = validateDocument({ ...doc, unexpected: '<script>' })
    expect(loaded).toEqual(doc); expect(loaded).not.toHaveProperty('unexpected')
    expect(loaded.components[0].value).toBe('100 V RMS')
    expect(loaded.components[0].detail).toBe('50 Hz ∠30°')
  })
})

describe('electrically misleading geometry', () => {
  function looseWires(lines: [number, number, number, number][]): CircuitDocument {
    const doc = blankDocument()
    lines.forEach(([x1, y1, x2, y2], i) => {
      const from = { id: `j${i}a`, x: x1, y: y1, label: '', terminal: true }, to = { id: `j${i}b`, x: x2, y: y2, label: '', terminal: true }
      doc.junctions.push(from, to)
      doc.wires.push({ id: `w${i}`, from: { type: 'junction', id: from.id }, to: { type: 'junction', id: to.id }, route: 'hv' })
    })
    return doc
  }
  it('permits open components, open terminal circuits and ordinary disconnected crossings', () => {
    const doc = blankDocument(); doc.components.push(createComponent('resistor', 300, 300))
    expect(getExportIssues(doc)).toEqual([])
    expect(getExportIssues(looseWires([[100, 300, 700, 300], [400, 100, 400, 500]]))).toEqual([])
  })
  it('rejects collinear overlap and contact of distinct wire nets in either direction', () => {
    for (const lines of [
      [[100, 200, 500, 200], [300, 200, 700, 200]],
      [[100, 200, 300, 200], [300, 200, 700, 200]],
      [[400, 100, 400, 300], [400, 200, 400, 500]],
    ] as [number, number, number, number][][]) {
      const doc = looseWires(lines)
      expect(getExportIssues(doc).some(issue => issue.includes('同一直線'))).toBe(true)
    }
  })
  it('does not reject a split continuous wire belonging to the same net', () => {
    const doc = looseWires([[100, 200, 700, 200]])
    const split = splitWire(doc, 'w0', { x: 400, y: 200 })!
    expect(getExportIssues(split.doc)).toEqual([])
  })
  it('rejects coincident but unconnected ports; explicit zero-length connection resolves it', () => {
    const doc = blankDocument(), first = createComponent('resistor', 200, 200), second = createComponent('resistor', 280, 200)
    doc.components.push(first, second)
    expect(getExportIssues(doc).some(issue => issue.includes('別の端子'))).toBe(true)
    doc.wires.push({ id: 'join', from: { type: 'component', id: first.id, port: 1 }, to: { type: 'component', id: second.id, port: 0 }, route: 'hv' })
    expect(getExportIssues(doc)).toEqual([])
  })
  it('rejects a component terminal lying on a foreign wire without explicit attachment', () => {
    const doc = looseWires([[100, 200, 700, 200]])
    const component = createComponent('resistor', 400, 240); component.rotation = 90; doc.components.push(component)
    expect(getExportIssues(doc).some(issue => issue.includes('接続されていない配線'))).toBe(true)
    const split = splitWire(doc, 'w0', { x: 400, y: 200 })!
    split.doc.wires.push({ id: 'join', from: split.anchor, to: { type: 'component', id: component.id, port: 0 }, route: 'hv' })
    expect(getExportIssues(split.doc)).toEqual([])
  })
  it('rejects wire through component body, including its own return segment after movement', () => {
    const doc = looseWires([[100, 200, 700, 200]])
    doc.components.push(createComponent('resistor', 400, 200))
    expect(getExportIssues(doc).some(issue => issue.includes('本体内'))).toBe(true)
    const own = blankDocument(), component = createComponent('resistor', 400, 200); own.components.push(component)
    own.junctions.push({ id: 'end', x: 100, y: 400, label: '', terminal: true })
    own.wires.push({ id: 'bad-route', from: { type: 'component', id: component.id, port: 1 }, to: { type: 'junction', id: 'end' }, route: 'hv' })
    expect(getExportIssues(own).some(issue => issue.includes('本体内'))).toBe(true)
    own.wires[0].route = 'vh'
    expect(getExportIssues(own)).toEqual([])
  })
})

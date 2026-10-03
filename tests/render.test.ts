import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircuitSvg, diagramBounds } from '../src/CircuitSvg'
import { svgMarkup } from '../src/export'
import { blankDocument, createComponent } from '../src/model'
import { templates } from '../src/templates'
import type { CircuitDocument, Junction } from '../src/types'

const junction = (id: string, x: number, y: number): Junction => ({ id, x, y, label: '', terminal: false })
const wire = (id: string, from: string, to: string) => ({ id, from: { type: 'junction' as const, id: from }, to: { type: 'junction' as const, id: to }, route: 'hv' as const })
function crossedWires(): CircuitDocument {
  const doc = blankDocument()
  doc.junctions = [junction('left', 0, 100), junction('right', 200, 100), junction('top', 100, 0), junction('bottom', 100, 200)]
  doc.wires = [wire('horizontal', 'left', 'right'), wire('vertical', 'top', 'bottom')]
  return doc
}

describe('deterministic, safe SVG exports', () => {
  it.each(templates.map(template => [template.id, template.create] as const))('%s exports only black electrical artwork with finite, nonempty bounds', (_id, create) => {
    const doc = create()
    const svg = svgMarkup(doc)
    expect(svg).toBe(svgMarkup(doc))
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toMatch(/NaN|Infinity|circuit-grid|#2563eb|#eff6ff|stroke="transparent"/)
    const bounds = diagramBounds(doc)
    expect(bounds.width).toBeGreaterThan(100)
    expect(bounds.height).toBeGreaterThan(100)
    for (const component of doc.components) {
      expect(component.x - 40).toBeGreaterThanOrEqual(bounds.x)
      expect(component.x + 40).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(component.y - 40).toBeGreaterThanOrEqual(bounds.y)
      expect(component.y + 40).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })

  it('escapes imported labels, titles and annotations instead of creating active markup', () => {
    const doc = blankDocument()
    doc.title = '<script>alert(1)</script>'
    const resistor = createComponent('resistor', 300, 300)
    resistor.label = '<image href="https://example.invalid/x">'
    resistor.detail = 'Ω μF ∠30° & 日本語'
    doc.components.push(resistor)
    doc.annotations.push({ id: 'text', kind: 'text', x: 300, y: 500, rotation: 0, text: '<foreignObject onload="alert(1)">' })
    const svg = svgMarkup(doc)
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<image ')
    expect(svg).not.toContain('<foreignObject ')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('Ω μF ∠30° &amp; 日本語')
  })

  it('preserves Unicode and renders underscore subscripts as SVG text', () => {
    const doc = blankDocument()
    const resistor = createComponent('resistor', 300, 300)
    resistor.label = 'R_12'
    resistor.value = '10√3'
    resistor.unit = 'Ω'
    doc.components.push(resistor)
    const svg = svgMarkup(doc)
    expect(svg).toContain('baseline-shift="sub"')
    expect(svg).toContain('>12</tspan>')
    expect(svg).toContain('10√3 Ω')
    expect(svg).not.toContain('<path d="M 82')
  })

  it('renders question, blank and hidden values without leaking the original value', () => {
    const doc = blankDocument()
    const resistor = createComponent('resistor', 300, 300)
    resistor.label = 'unique-label'
    resistor.value = '12345'
    doc.components.push(resistor)
    resistor.labelMode = 'question'
    expect(svgMarkup(doc)).toContain('? Ω')
    expect(svgMarkup(doc)).not.toContain('12345')
    resistor.labelMode = 'blank'
    expect(svgMarkup(doc)).toContain('＿＿ Ω')
    expect(svgMarkup(doc)).not.toContain('12345')
    resistor.labelMode = 'hidden'
    expect(svgMarkup(doc)).not.toContain('unique-label')
    expect(svgMarkup(doc)).not.toContain('12345')
  })

  it('makes disconnected orthogonal crossings visibly discontinuous', () => {
    const svg = svgMarkup(crossedWires())
    expect(svg).toContain('M 0 100 H 94 M 106 100 H 200')
    expect(svg).toContain('M 100 0 L 100 200')
    expect(svg).not.toContain('cx="100" cy="100" r="3.6"')
  })

  it('keeps wires continuous at a shared anchor and marks a real three-way junction', () => {
    const doc = crossedWires()
    doc.junctions.push(junction('joint', 100, 100))
    doc.wires = [wire('left-arm', 'left', 'joint'), wire('right-arm', 'joint', 'right'), wire('down-arm', 'joint', 'bottom')]
    const svg = svgMarkup(doc)
    expect(svg).toContain('M 0 100 H 100')
    expect(svg).toContain('M 100 100 H 200')
    expect(svg).toContain('cx="100" cy="100" r="3.6"')
  })

  it('includes offset labels and distant annotations, and adds requested export margin', () => {
    const doc = blankDocument()
    doc.settings.showTitle = false
    const resistor = createComponent('resistor', 300, 300)
    resistor.labelDx = -700
    resistor.labelDy = -500
    resistor.label = '左に移した長い記号 R_123'
    doc.components.push(resistor)
    doc.annotations.push({ id: 'note', kind: 'text', x: 1200, y: 900, rotation: 0, text: '離れた位置の注記\n第2行' })
    doc.settings.margin = 20
    const narrow = diagramBounds(doc)
    expect(narrow.x).toBeLessThan(-400)
    expect(narrow.y).toBeLessThan(-200)
    expect(narrow.x + narrow.width).toBeGreaterThan(1200)
    expect(narrow.y + narrow.height).toBeGreaterThan(921)
    doc.settings.margin = 80
    const roomy = diagramBounds(doc)
    expect(roomy.x).toBe(narrow.x - 60)
    expect(roomy.y).toBe(narrow.y - 60)
    expect(roomy.width).toBe(narrow.width + 120)
    expect(roomy.height).toBe(narrow.height + 120)
  })

  it('omits editing affordances even when exporting selected components and visible ports', () => {
    const doc = templates[0].create()
    const svg = renderToStaticMarkup(createElement(CircuitSvg, { document: doc, exportMode: true, grid: true, showPorts: true, selected: { type: 'component', id: doc.components[0].id } }))
    expect(svg).not.toMatch(/circuit-grid|#2563eb|#eff6ff|data-type="port"|stroke="transparent"/)
  })
})

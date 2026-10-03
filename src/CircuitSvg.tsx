import type { ReactNode, SVGProps } from 'react'
import type { Annotation, CircuitComponent, CircuitDocument, Point, Selection } from './types'
import { anchorKey, resolveAnchor, wirePoints } from './model'

const INK = '#111111'
const FONT = '"Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif'
type Segment = { a: Point; b: Point; wireId: string }
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
const between = (n: number, a: number, b: number) => n >= Math.min(a, b) - 0.01 && n <= Math.max(a, b) + 0.01

/** SVG text remains text in exports; subscript markup is created only by React. */
export function ScriptText({ text }: { text: string }) {
  const pieces = text.split(/(_\{[^}]+\}|_[0-9A-Za-z]+)/g)
  return <>{pieces.map((part, i) => part.startsWith('_')
    ? <tspan key={i} baselineShift="sub" fontSize="72%">{part.replace(/^_\{?/, '').replace(/\}$/, '')}</tspan>
    : <tspan key={i}>{part}</tspan>)}</>
}

function labelLines(component: CircuitComponent): string[] {
  if (component.labelMode === 'hidden') return []
  const value = component.labelMode === 'question' ? '?' : component.labelMode === 'blank' ? '＿＿' : component.value
  return [component.label, [value, value ? component.unit : ''].filter(Boolean).join(' '), component.detail].filter(Boolean)
}

function labelLayout(component: CircuitComponent) {
  const lines = labelLines(component)
  return {
    lines,
    x: component.x + component.labelDx,
    y: component.y + component.labelDy,
    anchor: 'middle' as const,
  }
}

function annotationLabel(annotation: Annotation) {
  const vertical = annotation.rotation % 180 !== 0
  return {
    x: annotation.x + (annotation.kind !== 'text' && vertical ? 26 : 0),
    y: annotation.y + (annotation.kind === 'text' ? 0 : vertical ? 5 : -20),
    anchor: annotation.kind === 'text' || vertical ? 'start' as const : 'middle' as const,
  }
}

export type DiagramBounds = { x: number; y: number; width: number; height: number }
function textWidth(text: string) {
  // Allow a full em for wide Latin glyphs (W/M), CJK and fallback fonts.
  return Math.max(18, [...text.replace(/_\{?([^}]+)\}?/g, '$1')].length * 18)
}

/** Conservative text bounds keep all editable labels inside the exported page. */
export function diagramBounds(document: CircuitDocument): DiagramBounds {
  const bounds: { x1: number; y1: number; x2: number; y2: number }[] = []
  const box = (x: number, y: number, width: number, height: number) => bounds.push({ x1: x, y1: y, x2: x + width, y2: y + height })
  const textBox = (text: string, x: number, y: number, anchor: 'start' | 'middle') => {
    const width = textWidth(text)
    box(x - (anchor === 'middle' ? width / 2 : 0) - 3, y - 20, width + 6, 27)
  }
  document.components.forEach(component => {
    const vertical = component.rotation % 180 !== 0
    box(component.x - (vertical ? 25 : 42), component.y - (vertical ? 42 : 25), vertical ? 50 : 84, vertical ? 84 : 50)
    const layout = labelLayout(component)
    layout.lines.forEach((line, index) => textBox(line, layout.x, layout.y + index * 19, layout.anchor))
  })
  document.wires.forEach(wire => wirePoints(document, wire).forEach(point => box(point.x - 2, point.y - 2, 4, 4)))
  document.junctions.forEach(node => {
    box(node.x - 6, node.y - 6, 12, 12)
    if (node.label) textBox(node.label, node.x + 12, node.y - 12, 'start')
  })
  document.annotations.forEach(annotation => {
    if (annotation.kind !== 'text') box(annotation.x - 60, annotation.y - 60, 120, 120)
    const layout = annotationLabel(annotation)
    annotation.text.split('\n').forEach((line, index) => textBox(line, layout.x, layout.y + index * 21, layout.anchor))
  })
  if (!bounds.length) box(0, 0, 240, 120)
  let x1 = Math.min(...bounds.map(bound => bound.x1))
  let x2 = Math.max(...bounds.map(bound => bound.x2))
  let y1 = Math.min(...bounds.map(bound => bound.y1))
  const y2 = Math.max(...bounds.map(bound => bound.y2))
  if (document.settings.showTitle && document.title) {
    const width = textWidth(document.title) * 1.25
    const middle = (x1 + x2) / 2
    x1 = Math.min(x1, middle - width / 2)
    x2 = Math.max(x2, middle + width / 2)
    y1 -= 50
  }
  const margin = Math.max(8, Math.min(240, document.settings.margin || 24))
  return { x: Math.floor(x1 - margin), y: Math.floor(y1 - margin), width: Math.ceil(x2 - x1 + margin * 2), height: Math.ceil(y2 - y1 + margin * 2) }
}

function Symbol({ component, resistorStyle }: { component: CircuitComponent; resistorStyle: 'iec' | 'zigzag' }) {
  const lead = <path d="M -40 0 H -24 M 24 0 H 40" />
  switch (component.kind) {
    case 'resistor': return <>{lead}{resistorStyle === 'iec'
      ? <rect x="-24" y="-10" width="48" height="20" fill="white" />
      : <path d="M -24 0 L -20 -9 L -12 9 L -4 -9 L 4 9 L 12 -9 L 20 9 L 24 0" />}</>
    case 'inductor': return <>{lead}<path d="M -24 0 C -24 -17 -12 -17 -12 0 C -12 -17 0 -17 0 0 C 0 -17 12 -17 12 0 C 12 -17 24 -17 24 0" /></>
    case 'capacitor': return <><path d="M -40 0 H -6 M 6 0 H 40 M -6 -20 V 20 M 6 -20 V 20" /></>
    case 'battery': return <><path d="M -40 0 H -6 M 6 0 H 40 M -6 -22 V 22" /><path d="M 6 -12 V 12" strokeWidth="4" /><g transform={`translate(-20 -11) rotate(${-component.rotation})`}><text y="4" stroke="none" fill={INK} fontSize="14" textAnchor="middle">+</text></g><g transform={`translate(20 -11) rotate(${-component.rotation})`}><text y="4" stroke="none" fill={INK} fontSize="14" textAnchor="middle">−</text></g></>
    case 'switch': return <><path d="M -40 0 H -20 M 20 0 H 40" /><circle cx="-17" cy="0" r="3" fill="white" /><circle cx="17" cy="0" r="3" fill="white" /><path d={component.closed ? 'M -14 0 H 14' : 'M -14 -1 L 13 -19'} /></>
    default: return <>{lead}<circle cx="0" cy="0" r="24" fill="white" />{component.kind === 'ac'
      ? <path d="M -16 0 C -12 -15 -5 -15 0 0 C 5 15 12 15 16 0" transform={`rotate(${-component.rotation})`} />
      : component.kind === 'dc'
        ? <><g transform={`translate(-10 0) rotate(${-component.rotation})`}><text y="5" stroke="none" fill={INK} fontSize="19" textAnchor="middle">+</text></g><g transform={`translate(10 0) rotate(${-component.rotation})`}><text y="5" stroke="none" fill={INK} fontSize="19" textAnchor="middle">−</text></g></>
        : <text x="0" y="8" stroke="none" fill={INK} fontSize="24" textAnchor="middle" transform={`rotate(${-component.rotation})`}>{component.kind === 'ammeter' ? 'A' : 'V'}</text>}</>
  }
}

/** Gaps are geometry, not white overlays, so they also work in transparent SVGs. */
function wirePaths(document: CircuitDocument): Map<string, string> {
  const segments: Segment[] = document.wires.flatMap(wire => {
    const points = wirePoints(document, wire)
    return points.slice(1).map((point, index) => ({ a: points[index], b: point, wireId: wire.id }))
  })
  const sharedEndpoints = new Map<string, Point[]>()
  document.wires.forEach((wire, index) => document.wires.slice(index + 1).forEach(other => {
    const common = [wire.from, wire.to].filter(anchor => [other.from, other.to].some(otherAnchor => anchorKey(anchor) === anchorKey(otherAnchor)))
    sharedEndpoints.set([wire.id, other.id].sort().join('|'), common.map(anchor => resolveAnchor(document, anchor)).filter((point): point is Point => Boolean(point)))
  }))
  const result = new Map<string, string>()
  segments.forEach(segment => {
    const horizontal = segment.a.y === segment.b.y
    let path = ''
    if (horizontal && segment.a.x !== segment.b.x) {
      const cuts: number[] = []
      segments.forEach(other => {
        if (other.wireId === segment.wireId || other.a.x !== other.b.x || other.a.y === other.b.y) return
        const crossing = { x: other.a.x, y: segment.a.y }
        if (!between(crossing.x, segment.a.x, segment.b.x) || !between(crossing.y, other.a.y, other.b.y)) return
        if (sharedEndpoints.get([segment.wireId, other.wireId].sort().join('|'))?.some(point => samePoint(point, crossing))) return
        cuts.push(crossing.x)
      })
      const left = Math.min(segment.a.x, segment.b.x)
      const right = Math.max(segment.a.x, segment.b.x)
      let cursor = left
      const sortedCuts = [...new Set(cuts)].sort((a, b) => a - b)
      sortedCuts.forEach(cut => {
        const end = Math.max(left, cut - 6)
        if (end > cursor) path += `M ${cursor} ${segment.a.y} H ${end} `
        cursor = Math.max(cursor, Math.min(right, cut + 6))
      })
      if (cursor < right) path += `M ${cursor} ${segment.a.y} H ${right} `
    } else path = `M ${segment.a.x} ${segment.a.y} L ${segment.b.x} ${segment.b.y} `
    result.set(segment.wireId, (result.get(segment.wireId) || '') + path)
  })
  return result
}

type CircuitSvgProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  document: CircuitDocument; selected?: Selection; showPorts?: boolean; grid?: boolean; children?: ReactNode; exportMode?: boolean;
}

export function CircuitSvg({ document, selected = null, showPorts = false, grid = false, children, exportMode = false, ...svgProps }: CircuitSvgProps) {
  const paths = wirePaths(document)
  const bounds = diagramBounds(document)
  const margin = Math.max(8, Math.min(240, document.settings.margin || 24))
  const isSelected = (type: NonNullable<Selection>['type'], id: string) => !exportMode && selected?.type === type && selected.id === id
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 680" role="img" aria-label={document.title || '電気回路図'} {...svgProps} style={{ fontFamily: FONT, ...svgProps.style }}>
    <title>{document.title || '電気回路図'}</title>
    {grid && !exportMode && <><defs><pattern id="circuit-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1" fill="#cbd5e1" /></pattern></defs><rect width="1040" height="680" fill="url(#circuit-grid)" pointerEvents="none" /></>}
    {exportMode && document.settings.showTitle && document.title && <text x={bounds.x + bounds.width / 2} y={bounds.y + margin + 25} textAnchor="middle" fontSize="22" fontWeight="700" fill={INK}><ScriptText text={document.title} /></text>}
    <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {document.wires.map(wire => <g key={wire.id} data-type="wire" data-id={wire.id}>
        {!exportMode && <path d={paths.get(wire.id)} stroke="transparent" strokeWidth="16" pointerEvents="stroke" />}
        {isSelected('wire', wire.id) && <path d={paths.get(wire.id)} stroke="#b5d5ff" strokeWidth="7" pointerEvents="none" />}
        <path d={paths.get(wire.id)} pointerEvents="none" />
      </g>)}
      {document.components.map(component => {
        const layout = labelLayout(component)
        return <g key={component.id} data-type="component" data-id={component.id}>
          <g transform={`translate(${component.x} ${component.y}) rotate(${component.rotation})`}>
            {!exportMode && <rect x="-41" y="-28" width="82" height="56" rx="5" stroke={isSelected('component', component.id) ? '#2563eb' : 'none'} strokeWidth="1.5" strokeDasharray="4 3" fill={isSelected('component', component.id) ? '#eff6ff' : 'transparent'} pointerEvents="all" />}
            <g pointerEvents="none"><Symbol component={component} resistorStyle={document.settings.resistorStyle} /></g>
          </g>
          <g fill={INK} stroke="none" fontSize="16" textAnchor={layout.anchor}>
            {layout.lines.map((line, index) => <text key={index} x={layout.x} y={layout.y + index * 19} fontWeight={index === 0 && component.label ? '600' : '400'}><ScriptText text={line} /></text>)}
          </g>
          {([0, 1] as const).map(port => {
            const anchor = { type: 'component' as const, id: component.id, port }
            const degree = document.wires.filter(wire => anchorKey(wire.from) === anchorKey(anchor) || anchorKey(wire.to) === anchorKey(anchor)).length
            const point = resolveAnchor(document, anchor)
            return degree >= 2 && point && <circle key={`joint-${port}`} cx={point.x} cy={point.y} r="3.6" fill={INK} pointerEvents="none" />
          })}
          {showPorts && !exportMode && ([0, 1] as const).map(port => {
            const point = resolveAnchor(document, { type: 'component', id: component.id, port })
            return point && <g key={port} data-type="port" data-id={component.id} data-port={port}>
              <circle cx={point.x} cy={point.y} r="12" fill="transparent" stroke="none" pointerEvents="all" />
              <circle cx={point.x} cy={point.y} r="4" fill="white" stroke="#2563eb" strokeWidth="1.6" pointerEvents="none" />
            </g>
          })}
        </g>
      })}
      {document.junctions.map(node => {
        const degree = document.wires.reduce((sum, wire) => sum + Number(wire.from.type === 'junction' && wire.from.id === node.id) + Number(wire.to.type === 'junction' && wire.to.id === node.id), 0)
        return <g key={node.id} data-type="junction" data-id={node.id}>
          {!exportMode && <circle cx={node.x} cy={node.y} r="12" fill="transparent" stroke={isSelected('junction', node.id) ? '#2563eb' : 'none'} strokeDasharray="3 2" pointerEvents="all" />}
          {(node.terminal || degree >= 3) && <circle cx={node.x} cy={node.y} r={node.terminal ? 5 : 3.6} fill={node.terminal ? 'white' : INK} pointerEvents="none" />}
          {!exportMode && !node.terminal && degree < 3 && showPorts && <circle cx={node.x} cy={node.y} r="3.5" fill="white" stroke="#2563eb" pointerEvents="none" />}
          {node.label && <text x={node.x + 12} y={node.y - 12} fill={INK} stroke="none" fontSize="16" textAnchor="start"><ScriptText text={node.label} /></text>}
        </g>
      })}
      {document.annotations.map(annotation => {
        const layout = annotationLabel(annotation)
        return <g key={annotation.id} data-type="annotation" data-id={annotation.id}>
          {annotation.kind !== 'text' && <g transform={`translate(${annotation.x} ${annotation.y}) rotate(${annotation.rotation})`}>
            {!exportMode && <rect x="-54" y="-12" width="108" height="24" fill="transparent" stroke={isSelected('annotation', annotation.id) ? '#2563eb' : 'none'} strokeDasharray="3 2" pointerEvents="all" />}
            {annotation.kind === 'current' ? <><path d="M -34 0 H 34" /><path d="M 24 -6 L 34 0 L 24 6" /></> : <><path d="M -28 0 H 28" /><path d="M -18 -6 L -28 0 L -18 6" /><g transform={`translate(-43 0) rotate(${-annotation.rotation})`}><text y="5" fill={INK} stroke="none" fontSize="17" textAnchor="middle">+</text></g><g transform={`translate(43 0) rotate(${-annotation.rotation})`}><text y="5" fill={INK} stroke="none" fontSize="17" textAnchor="middle">−</text></g></>}
          </g>}
          {annotation.text.split('\n').map((line, index) => <text key={index} x={layout.x} y={layout.y + index * 21} fill={isSelected('annotation', annotation.id) ? '#1d4ed8' : INK} stroke="none" fontSize="17" textAnchor={layout.anchor}><ScriptText text={line} /></text>)}
        </g>
      })}
    </g>
    {!exportMode && children}
  </svg>
}

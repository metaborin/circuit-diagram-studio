export type Point = { x: number; y: number }
export type ComponentKind = 'resistor' | 'inductor' | 'capacitor' | 'battery' | 'dc' | 'ac' | 'switch' | 'ammeter' | 'voltmeter'
export type CircuitComponent = {
  id: string; kind: ComponentKind; x: number; y: number; rotation: 0 | 90 | 180 | 270;
  label: string; value: string; unit: string; detail: string; labelMode: 'show' | 'question' | 'blank' | 'hidden';
  labelDx: number; labelDy: number; closed?: boolean;
}
export type Junction = { id: string; x: number; y: number; label: string; terminal: boolean }
export type Anchor = { type: 'component'; id: string; port: 0 | 1 } | { type: 'junction'; id: string }
export type Wire = { id: string; from: Anchor; to: Anchor; route: 'hv' | 'vh'; via?: Point[] }
export type Annotation = { id: string; kind: 'text' | 'current' | 'voltage'; x: number; y: number; rotation: 0 | 90 | 180 | 270; text: string }
export type CircuitDocument = {
  version: 1; title: string; components: CircuitComponent[]; junctions: Junction[]; wires: Wire[]; annotations: Annotation[];
  settings: { resistorStyle: 'iec' | 'zigzag'; margin: number; showTitle: boolean }
}
export type Selection = { type: 'component' | 'junction' | 'wire' | 'annotation'; id: string } | null
export type Template = { id: string; name: string; category: string; description: string; create: () => CircuitDocument }

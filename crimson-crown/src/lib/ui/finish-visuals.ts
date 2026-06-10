export type FoilVisualKind = 'none' | 'foil' | 'surge'

function normalizeFinish(finish?: string | null) {
  return String(finish || '').toLowerCase().trim()
}

export function getFoilVisualKind(isFoil: boolean, finish?: string | null): FoilVisualKind {
  if (!isFoil) return 'none'
  const value = normalizeFinish(finish)
  if (
    value.includes('surge') ||
    value.includes('ripple') ||
    value.includes('galaxy') ||
    value.includes('halo')
  ) {
    return 'surge'
  }
  return 'foil'
}

export function getFoilFrameClass(kind: FoilVisualKind) {
  if (kind === 'none') {
    return 'rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-xl transition-all duration-300'
  }
  if (kind === 'surge') {
    return 'relative p-[3px] rounded-xl bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-300 animate-gradient-xy shadow-xl'
  }
  return 'relative p-[3px] rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 animate-gradient-xy shadow-xl'
}

export function getFoilContentClass(kind: FoilVisualKind) {
  if (kind === 'none') return 'h-full flex flex-col overflow-hidden relative'
  return 'bg-white rounded-[9px] h-full overflow-hidden flex flex-col w-full relative z-10'
}

export function getFoilImageContainerClass(kind: FoilVisualKind) {
  if (kind === 'surge') return 'foil-surge-container'
  return ''
}

export function getFoilOverlayLayers(kind: FoilVisualKind): string[] {
  if (kind === 'none') return []
  if (kind === 'surge') {
    return [
      'foil-overlay-layer surge-texture-layer animate-foil-pan',
    ]
  }
  return [
    'foil-overlay-layer foil-layer-1',
    'foil-overlay-layer foil-layer-2',
    'foil-overlay-layer foil-layer-3',
  ]
}

export function getFoilBadgeLabel(kind: FoilVisualKind, finish?: string | null) {
  if (kind === 'none') return ''
  const raw = String(finish || '').toUpperCase().replace('NON-FOIL', '').trim()
  if (kind === 'surge') return raw || 'SURGE FOIL'
  return raw || 'FOIL'
}

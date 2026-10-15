export type PaletteName = 'vivid' | 'pastel' | 'ocean' | 'colorblind'

/** Lane colour sets for the commit graph. */
export const PALETTES: Record<PaletteName, readonly string[]> = {
  // GitKraken-like rainbow
  vivid: ['#15a0bf', '#0669f7', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f25d2e', '#f2ca33', '#7bd938', '#2ece9d'],
  pastel: ['#7cc6e8', '#9fa8f5', '#c7a2f0', '#f0a2d8', '#f5a3a3', '#f5c08a', '#e8dc8a', '#a8e09a', '#8fe0c4', '#b5c4d6'],
  ocean: ['#0b7fab', '#1f9e89', '#2a6fdb', '#35b779', '#4c9be8', '#20a4a4', '#5e60ce', '#3fb950', '#1e88e5', '#00acc1'],
  // Okabe-Ito: distinguishable with the common forms of colour blindness
  colorblind: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#999999']
}

export const laneColorFrom = (palette: PaletteName, lane: number): string => {
  const colors = PALETTES[palette]
  return colors[lane % colors.length]!
}

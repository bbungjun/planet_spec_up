export type Plane = { width: number; height: number; data: Uint8ClampedArray };

const red = (r: number, g: number, b: number) => r >= 120 && r > g * 1.6 && r > b * 1.6;

/** Share of glyph-bright pixels that are strongly red (unmet requirements are drawn in red). */
export function redShare(p: Plane): number {
  let bright = 0, reds = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
    if (Math.max(r, g, b) < 120) continue;
    bright++; if (red(r, g, b)) reds++;
  }
  return bright ? reds / bright : 0;
}

/** Red glyphs become white on the dark panel so a reader trained on white digits sees them.
 * Other pixels keep their colour; nothing is drawn or reconstructed. */
export function whitenRed(p: Plane): Plane {
  const data = new Uint8ClampedArray(p.data);
  for (let i = 0; i < data.length; i += 4) if (red(data[i], data[i + 1], data[i + 2])) data[i + 1] = data[i + 2] = data[i];
  return { width: p.width, height: p.height, data };
}

/** True when the row band holds glyph pixels at all; an empty placed row is never read. */
export function hasGlyphs(p: Plane): boolean {
  let count = 0;
  for (let i = 0; i < p.data.length; i += 4) if (Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) >= 150) count++;
  return count >= p.height * 2;
}

/**
 * Ends a value region at the first blank gap wider than the row height after its first glyph,
 * so marks further right (another column, a cursor) are not read as extra digits.
 */
export function trimAtGap(p: Plane, region: { x: number; width: number }): number {
  const column = (x: number) => {
    for (let y = 0; y < p.height; y++) {
      const i = (y * p.width + x) * 4;
      if (Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) >= 150) return true;
    }
    return false;
  };
  let first = -1, lastInk = -1;
  for (let x = region.x; x < region.x + region.width; x++) {
    if (column(x)) { if (first < 0) first = x; lastInk = x; }
    else if (first >= 0 && x - lastInk > p.height) break;
  }
  return first < 0 ? region.width : Math.min(region.width, lastInk - region.x + 1 + Math.max(2, Math.round(p.height * .2)));
}

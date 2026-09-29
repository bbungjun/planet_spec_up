export type TooltipRect = { x: number; y: number; width: number; height: number };
type Pixels = { width: number; height: number; data: ArrayLike<number> };
type Edge = { x: number; top: number; bottom: number; color: number[] };

function intersection(a: TooltipRect, b: TooltipRect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function compositeFrame(candidate: TooltipRect, all: TooltipRect[]): boolean {
  const children = all.filter(other => other !== candidate && other.width >= candidate.width * .4 && other.width < candidate.width * .8 && other.height > candidate.height * .6
    && intersection(candidate, other) / (other.width * other.height) > .9);
  return children.some((first, i) => children.slice(i + 1).some(second => intersection(first, second) / Math.min(first.width * first.height, second.width * second.height) < .15));
}

/** Find tall, closed, colored frames with a dark interior. Coordinates and
 * colors come from pixels, never from a particular screenshot or item name. */
function detectStrictFrames({ width, height, data }: Pixels): TooltipRect[] {
  const colorAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const colored = (color: number[]) => Math.max(...color) >= 100 && Math.max(...color) - Math.min(...color) >= 45;
  const similar = (first: number[], second: number[]) => first.every((value, i) => Math.abs(value - second[i]) <= 32);
  const minimumEdge = Math.max(90, Math.round(height * .055));
  const edges: Edge[] = [];
  for (let x = 0; x < width; x++) {
    let start = -1, last = -1, count = 0;
    let color: number[] = [];
    for (let y = 0; y <= height; y++) {
      const pixel = y < height ? colorAt(x, y) : [0, 0, 0];
      if (y < height && colored(pixel) && (start < 0 || similar(color, pixel))) {
        if (start < 0) { start = y; color = pixel; }
        last = y;
        count++;
      } else if (start >= 0 && (y - last > 3 || y === height)) {
        if (last - start >= minimumEdge && count / (last - start + 1) >= .9) edges.push({ x, top: start, bottom: last, color });
        start = -1;
        count = 0;
      }
    }
  }
  // Bound the pairing work even in noisy screenshots.
  edges.sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top));
  const strongest: Edge[] = [];
  for (const edge of edges) {
    if (!strongest.some(other => Math.abs(other.x - edge.x) <= 3 && Math.abs(other.top - edge.top) <= 4 && Math.abs(other.bottom - edge.bottom) <= 4)) strongest.push(edge);
    if (strongest.length === 80) break;
  }
  const horizontalEdge = (left: number, right: number, y: number, color: number[]) => {
    let best = { coverage: 0, y };
    const radius = Math.max(6, Math.round((right - left) * .03));
    for (let offset = -radius; offset <= radius; offset++) {
      if (y + offset < 0 || y + offset >= height) continue;
      let matches = 0, samples = 0;
      for (let x = left; x <= right; x += 3) {
        samples++;
        if (similar(color, colorAt(x, y + offset))) matches++;
      }
      if (matches / samples > best.coverage) best = { coverage: matches / samples, y: y + offset };
    }
    return best;
  };
  const candidates: TooltipRect[] = [];
  for (const left of strongest) for (const right of strongest) {
    const w = right.x - left.x + 1;
    if (w < 90 || w > Math.min(width * .8, 1200) || !similar(left.color, right.color)) continue;
    let top = Math.min(left.top, right.top), bottom = Math.max(left.bottom, right.bottom);
    const h = bottom - top + 1;
    const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
    if (h < w * 1.1 || h > w * 5 || overlap < h * .6) continue;
    const topEdge = horizontalEdge(left.x, right.x, top, right.color);
    const bottomEdge = horizontalEdge(left.x, right.x, bottom, right.color);
    if (topEdge.coverage < .8 || bottomEdge.coverage < .8) continue;
    top = topEdge.y;
    bottom = bottomEdge.y;
    let dark = 0, samples = 0;
    for (let y = top + 5; y < bottom - 4; y += 9) for (let x = left.x + 5; x < right.x - 4; x += 9) {
      const [r, g, b] = colorAt(x, y);
      if ((r + g + b) / 3 < 150) dark++;
      samples++;
    }
    if (!samples || dark / samples < .65) continue;
    candidates.push({ x: left.x, y: top, width: w, height: bottom - top + 1 });
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  const separate = candidates.filter(candidate => !compositeFrame(candidate, candidates));
  return separate.filter((candidate, i) => !separate.slice(0, i).some(other => {
    const intersection = Math.max(0, Math.min(candidate.x + candidate.width, other.x + other.width) - Math.max(candidate.x, other.x))
      * Math.max(0, Math.min(candidate.y + candidate.height, other.y + other.height) - Math.max(candidate.y, other.y));
    return intersection / (candidate.width * candidate.height) > .8;
  }));
}

/** Fallback uses hue continuity or a dark boundary's contrast, so translucent
 * edges need not have identical RGB values on every side. */
function detectFlexibleFrames({ width, height, data }: Pixels, neutral: boolean): TooltipRect[] {
  const channel = (x: number, y: number, c: number) => data[(y * width + x) * 4 + c];
  const family = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const r = channel(x, y, 0), g = channel(x, y, 1), b = channel(x, y, 2);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (neutral) return max < 135 && min > 3 ? 1 : 0;
    if (max < 75 || max - min < 35) return 0;
    if (r > b * 1.35 && g > b * 1.2 && r / g > .8 && r / g < 1.9) return 1;
    if (b > r * 1.2 && g > r * 1.1) return 2;
    if (r > g * 1.3 && b > g * 1.2) return 3;
    return 0;
  };
  const edge = (x: number, y: number, horizontal: boolean) => {
    const kind = family(x, y);
    if (!kind || !neutral) return kind;
    const differences: number[] = [];
    for (const offset of [-2, 2]) {
      const nx = horizontal ? x : x + offset, ny = horizontal ? y + offset : y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      differences.push(Math.max(...[0, 1, 2].map(c => Math.abs(channel(x, y, c) - channel(nx, ny, c)))));
    }
    return Math.max(...differences) >= 20 ? kind : 0;
  };
  const segments: Array<{ x: number; top: number; bottom: number; kind: number; coverage: number }> = [];
  const minimum = Math.max(65, Math.round(height * .04));
  for (let x = 1; x < width - 1; x++) {
    let start = -1, last = -1, kind = 0, hits = 0;
    for (let y = 0; y <= height; y++) {
      const next = y < height ? edge(x, y, false) : 0;
      if (next && (start < 0 || next === kind)) {
        if (start < 0) { start = y; kind = next; }
        last = y; hits++;
      } else if (start >= 0 && (y - last > (neutral ? Math.max(8, Math.round(height * .02)) : 4) || y === height)) {
        if (last - start >= minimum && hits / (last - start + 1) > .8) segments.push({ x, top: start, bottom: last, kind, coverage: hits / (last - start + 1) });
        start = -1; hits = 0;
      }
    }
  }
  segments.sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top));
  const edges: typeof segments = [];
  for (const segment of segments) {
    if (!edges.some(other => Math.abs(other.x - segment.x) <= 2 && Math.abs(other.top - segment.top) <= 5 && Math.abs(other.bottom - segment.bottom) <= 5)) edges.push(segment);
    if (edges.length === 100) break;
  }
  const horizontal = (left: number, right: number, y: number, kind: number) => {
    let best = { y, score: 0 };
    const radius = Math.max(8, Math.round((right - left) * .18));
    for (let row = Math.max(0, y - radius); row <= Math.min(height - 1, y + radius); row++) {
      let hits = 0, samples = 0;
      for (let x = left + 2; x < right - 1; x += 3) { samples++; if (edge(x, row, true) === kind) hits++; }
      if (hits / samples > best.score || (hits / samples === best.score && Math.abs(row - y) < Math.abs(best.y - y))) best = { y: row, score: hits / samples };
    }
    return best;
  };
  const found: Array<TooltipRect & { score: number }> = [];
  for (const left of edges) for (const right of edges) {
    const w = right.x - left.x + 1;
    if (w < 85 || w > Math.min(width * .8, 1200) || left.kind !== right.kind) continue;
    const top = Math.min(left.top, right.top), bottom = Math.max(left.bottom, right.bottom), h = bottom - top + 1;
    if (h < w * .85 || h > w * 5 || Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) < h * .55) continue;
    const upper = horizontal(left.x, right.x, top, left.kind), lower = horizontal(left.x, right.x, bottom, left.kind);
    if (upper.score < .75 || lower.score < .75) continue;
    if (lower.y - upper.y + 1 < w * .85 || lower.y - upper.y + 1 > w * 5) continue;
    let dark = 0, samples = 0;
    for (let y = upper.y + 6; y < lower.y - 5; y += 11) for (let x = left.x + 6; x < right.x - 5; x += 11) {
      if ((channel(x, y, 0) + channel(x, y, 1) + channel(x, y, 2)) / 3 < 155) dark++;
      samples++;
    }
    if (!samples || dark / samples < .65) continue;
    found.push({ x: left.x, y: upper.y, width: w, height: lower.y - upper.y + 1, score: upper.score + lower.score + left.coverage + right.coverage });
  }
  found.sort((a, b) => b.width * b.height - a.width * a.height || b.score - a.score);
  const distinct: TooltipRect[] = [];
  for (const candidate of found) {
    if (compositeFrame(candidate, found)) continue;
    if (distinct.some(other => {
      const intersection = Math.max(0, Math.min(other.x + other.width, candidate.x + candidate.width) - Math.max(other.x, candidate.x))
        * Math.max(0, Math.min(other.y + other.height, candidate.y + candidate.height) - Math.max(other.y, candidate.y));
      return intersection / Math.min(other.width * other.height, candidate.width * candidate.height) > .8;
    })) continue;
    const { x, y, width, height } = candidate;
    distinct.push({ x, y, width, height });
  }
  return distinct;
}

function withoutSmallControls(candidates: TooltipRect[]): TooltipRect[] {
  // Quick-slot buttons can share a tooltip's dark frame and bright icon.
  // Only suppress compact controls when the same image contains a much larger
  // portrait panel. Short tooltips of comparable width remain candidates.
  return candidates.filter(rect => rect.height > rect.width * 1.2
    || !candidates.some(other => other !== rect && other.height > other.width * 1.2
      && other.width >= rect.width * 2 && other.height >= rect.height * 2));
}

export function detectTooltipRegions(pixels: Pixels): TooltipRect[] {
  const strict = detectStrictFrames(pixels);
  // A strict inventory frame must not hide a translucent tooltip candidate.
  const candidates = [...strict, ...detectFlexibleFrames(pixels, false), ...detectFlexibleFrames(pixels, true)];
  const distinct: TooltipRect[] = [];
  for (const candidate of candidates) {
    if (compositeFrame(candidate, candidates)) continue;
    if (distinct.some(other => {
      const intersection = Math.max(0, Math.min(other.x + other.width, candidate.x + candidate.width) - Math.max(other.x, candidate.x))
        * Math.max(0, Math.min(other.y + other.height, candidate.y + candidate.height) - Math.max(other.y, candidate.y));
      return intersection / Math.min(other.width * other.height, candidate.width * candidate.height) > .8;
    })) continue;
    distinct.push(candidate);
  }
  return withoutSmallControls(distinct);
}

/** A tooltip has a continuous dark panel and sparse light text rows in its
 * option body. White inventory grids and dark help panels alone are not proof. */
function hasTooltipBody(pixels: Pixels, rect: TooltipRect): boolean {
  const pixel = (x: number, y: number) => {
    const at = (y * pixels.width + x) * 4;
    return [pixels.data[at], pixels.data[at + 1], pixels.data[at + 2]];
  };
  const step = Math.max(1, Math.round(rect.width / 160));
  for (const start of [.15, .35, .55, .75]) {
    let dark = 0, samples = 0;
    for (let y = Math.round(rect.y + rect.height * start); y < rect.y + rect.height * (start + .2); y += step * 2) {
      for (let x = Math.round(rect.x + rect.width * .05); x < rect.x + rect.width * .95; x += step * 2) {
        const color = pixel(x, y);
        if ((color[0] + color[1] + color[2]) / 3 < 155) dark++;
        samples++;
      }
    }
    if (!samples || dark / samples < .65) return false;
  }
  let textRows = 0, rows = 0;
  for (let y = Math.round(rect.y + rect.height * .4); y < rect.y + rect.height * .95; y += step) {
    let light = 0, samples = 0;
    for (let x = Math.round(rect.x + rect.width * .05); x < rect.x + rect.width * .9; x += step) {
      const color = pixel(x, y);
      if (Math.min(...color) > 170 && Math.max(...color) - Math.min(...color) < 80) light++;
      samples++;
    }
    const coverage = samples ? light / samples : 0;
    if (coverage >= .01 && coverage <= .3) textRows++;
    rows++;
  }
  return textRows >= Math.max(3, rows * .03);
}

/** Item icons distinguish gear from neighboring set-effect/help panels.
 * Multiple plausible gear tooltips still require a user's selection. */
export function selectTooltipRegion(pixels: Pixels, candidates: TooltipRect[]): TooltipRect | null {
  candidates = withoutSmallControls(candidates).filter(rect => hasTooltipBody(pixels, rect));
  if (candidates.length === 1) return candidates[0];
  const withIcon = candidates.filter(rect => {
    const side = Math.max(14, Math.round(rect.width * .16));
    for (let y = rect.y + side; y < rect.y + rect.height * .58 - side; y += Math.max(4, Math.round(side / 3))) {
      for (let x = rect.x + 5; x < rect.x + rect.width * .45 - side; x += Math.max(4, Math.round(side / 3))) {
        let bright = 0, total = 0;
        for (let dy = 0; dy < side; dy += 3) for (let dx = 0; dx < side; dx += 3) {
          const at = ((y + dy) * pixels.width + x + dx) * 4;
          const r = pixels.data[at], g = pixels.data[at + 1], b = pixels.data[at + 2];
          const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
          if ((minimum > 140 && maximum - minimum < 90) || (maximum > 120 && maximum - minimum > 40)) bright++;
          total++;
        }
        if (bright / total > .62) return true;
      }
    }
    return false;
  });
  return withIcon.length === 1 ? withIcon[0] : null;
}

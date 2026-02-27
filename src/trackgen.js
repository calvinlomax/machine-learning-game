import { RNG, normalizeSeed } from "./rng.js";

const TAU = Math.PI * 2;
const EDGE_MARGIN = 86;
const DEFAULT_TRACK_WIDTH = 112;
const DEFAULT_SAMPLES = 300;
const MIN_SHAPE_POINT_DISTANCE = 6;
const MAX_BOUNDARY_FIX_PASSES = 9;

export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 600;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapIndex(index, length) {
  return (index + length) % length;
}

function centripetalKnot(t, p0, p1, alpha = 0.5) {
  const distance = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return t + Math.max(1e-4, distance ** alpha);
}

function interpolateAt(p0, p1, t0, t1, t) {
  const denom = t1 - t0;
  if (Math.abs(denom) < 1e-6) {
    return { x: p1.x, y: p1.y };
  }
  const ratio = (t - t0) / denom;
  return {
    x: p0.x + (p1.x - p0.x) * ratio,
    y: p0.y + (p1.y - p0.y) * ratio
  };
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = centripetalKnot(t0, p0, p1);
  const t2 = centripetalKnot(t1, p1, p2);
  const t3 = centripetalKnot(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;

  const a1 = interpolateAt(p0, p1, t0, t1, tt);
  const a2 = interpolateAt(p1, p2, t1, t2, tt);
  const a3 = interpolateAt(p2, p3, t2, t3, tt);

  const b1 = interpolateAt(a1, a2, t0, t2, tt);
  const b2 = interpolateAt(a2, a3, t1, t3, tt);

  return interpolateAt(b1, b2, t1, t2, tt);
}

function sampleClosedCurve(controlPoints, sampleCount) {
  const samples = [];
  const count = controlPoints.length;

  for (let i = 0; i < sampleCount; i += 1) {
    const t = (i / sampleCount) * count;
    const seg = Math.floor(t);
    const localT = t - seg;

    const p0 = controlPoints[wrapIndex(seg - 1, count)];
    const p1 = controlPoints[wrapIndex(seg, count)];
    const p2 = controlPoints[wrapIndex(seg + 1, count)];
    const p3 = controlPoints[wrapIndex(seg + 2, count)];

    samples.push(catmullRomPoint(p0, p1, p2, p3, localT));
  }

  return samples;
}

function computeNormals(points) {
  const normals = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[wrapIndex(i - 1, points.length)];
    const next = points[wrapIndex(i + 1, points.length)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;

    normals.push({
      x: -ty / len,
      y: tx / len
    });
  }
  return normals;
}

function buildSegments(points) {
  const segments = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    segments.push({ a, b, dx, dy, length });
  }
  return segments;
}

function findStartIndex(centerline) {
  let start = 0;
  let bestY = Number.POSITIVE_INFINITY;

  for (let i = 0; i < centerline.length; i += 1) {
    if (centerline[i].y < bestY) {
      bestY = centerline[i].y;
      start = i;
    }
  }

  return start;
}

function createControlPoints(rng, worldWidth, worldHeight) {
  const centerX = worldWidth / 2;
  const centerY = worldHeight / 2;
  const baseRadius = Math.min(worldWidth, worldHeight) * 0.34;
  const pointCount = 11 + rng.int(0, 4);
  const xScale = 1.04 + rng.range(-0.09, 0.11);
  const yScale = 0.82 + rng.range(-0.07, 0.08);

  const points = [];
  for (let i = 0; i < pointCount; i += 1) {
    const angle = (i / pointCount) * TAU + rng.range(-0.1, 0.1);
    const radialNoise = 1 + rng.range(-0.28, 0.25);
    const radius = baseRadius * radialNoise;

    const x = clamp(centerX + Math.cos(angle) * radius * xScale, EDGE_MARGIN, worldWidth - EDGE_MARGIN);
    const y = clamp(centerY + Math.sin(angle) * radius * yScale, EDGE_MARGIN, worldHeight - EDGE_MARGIN);
    points.push({ x, y });
  }

  return points;
}

function sanitizeShapePoints(shapePoints, worldWidth, worldHeight) {
  if (!Array.isArray(shapePoints)) {
    return [];
  }

  const sanitized = [];
  for (let i = 0; i < shapePoints.length; i += 1) {
    const raw = shapePoints[i];
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
      continue;
    }

    const nextPoint = {
      x: clamp(raw.x, EDGE_MARGIN, worldWidth - EDGE_MARGIN),
      y: clamp(raw.y, EDGE_MARGIN, worldHeight - EDGE_MARGIN)
    };

    if (!sanitized.length) {
      sanitized.push(nextPoint);
      continue;
    }

    const prev = sanitized[sanitized.length - 1];
    if (Math.hypot(nextPoint.x - prev.x, nextPoint.y - prev.y) >= MIN_SHAPE_POINT_DISTANCE) {
      sanitized.push(nextPoint);
    }
  }

  if (sanitized.length > 1) {
    const first = sanitized[0];
    const last = sanitized[sanitized.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < MIN_SHAPE_POINT_DISTANCE) {
      sanitized.pop();
    }
  }

  if (sanitized.length <= 40) {
    return sanitized;
  }

  const maxPoints = 40;
  const reduced = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const t = i / maxPoints;
    const index = Math.floor(t * sanitized.length) % sanitized.length;
    reduced.push(sanitized[index]);
  }
  return reduced;
}

function orientation(a, b, c) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(cross) < 1e-9) {
    return 0;
  }
  return cross > 0 ? 1 : -1;
}

function onSegment(a, b, c) {
  return (
    c.x >= Math.min(a.x, b.x) - 1e-9 &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    c.y >= Math.min(a.y, b.y) - 1e-9 &&
    c.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function segmentsIntersect(p1, p2, q1, q2) {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

function isAdjacentSegment(i, j, count) {
  const delta = Math.abs(i - j);
  return delta <= 1 || delta === count - 1;
}

function hasSelfIntersections(points) {
  const count = points.length;
  if (count < 4) {
    return false;
  }

  for (let i = 0; i < count; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % count];
    for (let j = i + 1; j < count; j += 1) {
      if (isAdjacentSegment(i, j, count)) {
        continue;
      }

      const b1 = points[j];
      const b2 = points[(j + 1) % count];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

function hasCrossIntersections(leftBoundary, rightBoundary) {
  const countLeft = leftBoundary.length;
  const countRight = rightBoundary.length;

  for (let i = 0; i < countLeft; i += 1) {
    const a1 = leftBoundary[i];
    const a2 = leftBoundary[(i + 1) % countLeft];

    for (let j = 0; j < countRight; j += 1) {
      const b1 = rightBoundary[j];
      const b2 = rightBoundary[(j + 1) % countRight];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

function createBoundaries(centerline, width) {
  const normals = computeNormals(centerline);

  const halfWidth = width * 0.5;
  const leftBoundary = centerline.map((p, i) => ({
    x: p.x + normals[i].x * halfWidth,
    y: p.y + normals[i].y * halfWidth
  }));

  const rightBoundary = centerline.map((p, i) => ({
    x: p.x - normals[i].x * halfWidth,
    y: p.y - normals[i].y * halfWidth
  }));

  return { leftBoundary, rightBoundary };
}

function buildSafeBoundaries(centerline, requestedWidth) {
  const minAllowedWidth = Math.max(32, requestedWidth * 0.65);
  let effectiveWidth = Math.max(minAllowedWidth, requestedWidth);
  let boundaries = createBoundaries(centerline, effectiveWidth);

  for (let pass = 0; pass < MAX_BOUNDARY_FIX_PASSES; pass += 1) {
    const hasIssues =
      hasSelfIntersections(boundaries.leftBoundary) ||
      hasSelfIntersections(boundaries.rightBoundary) ||
      hasCrossIntersections(boundaries.leftBoundary, boundaries.rightBoundary);

    if (!hasIssues) {
      return {
        width: effectiveWidth,
        ...boundaries
      };
    }

    effectiveWidth = Math.max(minAllowedWidth, requestedWidth * 0.9 ** (pass + 1));
    boundaries = createBoundaries(centerline, effectiveWidth);
  }

  return {
    width: effectiveWidth,
    ...boundaries
  };
}

function buildTrackGeometry(centerline, { seed, worldWidth, worldHeight, width, startIndexOverride }) {
  const safeBoundaries = buildSafeBoundaries(centerline, width);
  const effectiveWidth = safeBoundaries.width;
  const leftBoundary = safeBoundaries.leftBoundary;
  const rightBoundary = safeBoundaries.rightBoundary;

  const segments = buildSegments(centerline);
  const boundarySegments = [...buildSegments(leftBoundary), ...buildSegments(rightBoundary)];

  const cumulativeLengths = [0];
  for (let i = 0; i < segments.length; i += 1) {
    cumulativeLengths.push(cumulativeLengths[i] + segments[i].length);
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] || 1;
  const fallbackStartIndex = findStartIndex(centerline);
  const startIndex = Number.isFinite(startIndexOverride)
    ? wrapIndex(Math.floor(startIndexOverride), centerline.length)
    : fallbackStartIndex;

  return {
    seed,
    worldWidth,
    worldHeight,
    width: effectiveWidth,
    centerline,
    leftBoundary,
    rightBoundary,
    segments,
    boundarySegments,
    cumulativeLengths,
    totalLength,
    startIndex,
    startLine: {
      a: leftBoundary[startIndex],
      b: rightBoundary[startIndex]
    }
  };
}

export function generateTrack(seed, options = {}) {
  const parsedSeed = normalizeSeed(seed);
  const rng = new RNG(parsedSeed);

  const worldWidth = options.worldWidth || WORLD_WIDTH;
  const worldHeight = options.worldHeight || WORLD_HEIGHT;
  const width = clamp(options.trackWidth || DEFAULT_TRACK_WIDTH, 80, 150);
  const samples = Math.max(120, Math.floor(options.samples || DEFAULT_SAMPLES));

  const controlPoints = createControlPoints(rng, worldWidth, worldHeight);
  const centerline = sampleClosedCurve(controlPoints, samples);
  return buildTrackGeometry(centerline, {
    seed: parsedSeed,
    worldWidth,
    worldHeight,
    width,
    startIndexOverride: Number.isFinite(options.startIndex) ? options.startIndex : undefined
  });
}

export function generateTrackFromShape(shapePoints, options = {}) {
  const parsedSeed = normalizeSeed(options.seed ?? 1);
  const worldWidth = options.worldWidth || WORLD_WIDTH;
  const worldHeight = options.worldHeight || WORLD_HEIGHT;
  const width = clamp(options.trackWidth || DEFAULT_TRACK_WIDTH, 80, 150);
  const samples = Math.max(120, Math.floor(options.samples || DEFAULT_SAMPLES));

  const controlPoints = sanitizeShapePoints(shapePoints, worldWidth, worldHeight);
  if (controlPoints.length < 4) {
    return generateTrack(parsedSeed, {
      worldWidth,
      worldHeight,
      trackWidth: width,
      samples,
      startIndex: 0
    });
  }

  const centerline = sampleClosedCurve(controlPoints, samples);
  return buildTrackGeometry(centerline, {
    seed: parsedSeed,
    worldWidth,
    worldHeight,
    width,
    startIndexOverride: 0
  });
}

export function wrappedProgressDelta(previous, current) {
  let delta = current - previous;
  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }
  return delta;
}

export function projectToCenterline(track, point) {
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let best = null;

  for (let i = 0; i < track.segments.length; i += 1) {
    const segment = track.segments[i];
    const vx = segment.dx;
    const vy = segment.dy;
    const lenSq = vx * vx + vy * vy || 1;

    const wx = point.x - segment.a.x;
    const wy = point.y - segment.a.y;
    const rawT = (wx * vx + wy * vy) / lenSq;
    const t = clamp(rawT, 0, 1);

    const projX = segment.a.x + vx * t;
    const projY = segment.a.y + vy * t;

    const dx = point.x - projX;
    const dy = point.y - projY;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq;
      const cross = vx * (point.y - projY) - vy * (point.x - projX);
      const distance = Math.sqrt(distSq);
      const signedDistance = cross >= 0 ? distance : -distance;
      const distanceAlong = track.cumulativeLengths[i] + segment.length * t;

      best = {
        progress: distanceAlong / track.totalLength,
        distance,
        signedDistance,
        tangentAngle: Math.atan2(vy, vx),
        point: { x: projX, y: projY },
        segmentIndex: i
      };
    }
  }

  return (
    best || {
      progress: 0,
      distance: 0,
      signedDistance: 0,
      tangentAngle: 0,
      point: { x: point.x, y: point.y },
      segmentIndex: 0
    }
  );
}

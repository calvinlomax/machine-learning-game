import { RNG, normalizeSeed } from "./rng.js";

const TAU = Math.PI * 2;
const EDGE_MARGIN = 86;
const DEFAULT_TRACK_WIDTH = 112;
const DEFAULT_SAMPLES = 300;
const MIN_SHAPE_POINT_DISTANCE = 6;

export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 600;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapIndex(index, length) {
  return (index + length) % length;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  const x =
    0.5 *
    ((2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

  const y =
    0.5 *
    ((2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

  return { x, y };
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

function buildTrackGeometry(centerline, { seed, worldWidth, worldHeight, width }) {
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

  const segments = buildSegments(centerline);
  const boundarySegments = [...buildSegments(leftBoundary), ...buildSegments(rightBoundary)];

  const cumulativeLengths = [0];
  for (let i = 0; i < segments.length; i += 1) {
    cumulativeLengths.push(cumulativeLengths[i] + segments[i].length);
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] || 1;
  const startIndex = findStartIndex(centerline);

  return {
    seed,
    worldWidth,
    worldHeight,
    width,
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
    width
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
      samples
    });
  }

  const centerline = sampleClosedCurve(controlPoints, samples);
  return buildTrackGeometry(centerline, {
    seed: parsedSeed,
    worldWidth,
    worldHeight,
    width
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

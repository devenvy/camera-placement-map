import { Camera } from '../models/camera.model';
import { BuildingPolygon } from '../services/building.service';

export interface Point2D {
  x: number;
  y: number;
}

interface Segment {
  a: Point2D;
  b: Point2D;
}

const DEG_TO_RAD = Math.PI / 180;
const R_EARTH = 6371000;
const TWO_PI = 2 * Math.PI;

// --- Coordinate projection (equirectangular, accurate at <500m) ---

export function toLocal(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
): Point2D {
  const cosLat = Math.cos(originLat * DEG_TO_RAD);
  return {
    x: (lng - originLng) * DEG_TO_RAD * R_EARTH * cosLat,
    y: (lat - originLat) * DEG_TO_RAD * R_EARTH,
  };
}

export function toLatLng(
  point: Point2D,
  originLat: number,
  originLng: number,
): [number, number] {
  const cosLat = Math.cos(originLat * DEG_TO_RAD);
  const lat = originLat + point.y / (R_EARTH * DEG_TO_RAD);
  const lng = originLng + point.x / (R_EARTH * cosLat * DEG_TO_RAD);
  return [lat, lng];
}

// --- Angle utilities ---
// Convention: 0 = north, clockwise. atan2(x, y) gives compass bearing in radians.

function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

function normalizeRadPositive(rad: number): number {
  return ((rad % TWO_PI) + TWO_PI) % TWO_PI;
}

function isAngleInArc(
  angle: number,
  startRad: number,
  endRad: number,
): boolean {
  const span = normalizeRadPositive(endRad - startRad);
  const test = normalizeRadPositive(angle - startRad);
  return test <= span + 1e-9;
}

// --- Ray-segment intersection ---

export function raySegmentIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number | null {
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;

  if (Math.abs(denom) < 1e-10) return null;

  const t = ((ax - ox) * ey - (ay - oy) * ex) / denom;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / denom;

  if (t < 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;

  return t;
}

// --- Simple FOV (no occlusion) ---

export function computeSimpleFov(camera: Camera): [number, number][] {
  const { lat, lng, heading, fov, range } = camera;
  const points: [number, number][] = [[lat, lng]];

  const segments = 32;
  const startAngle = heading - fov / 2;
  const step = fov / segments;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + step * i;
    const rad = degToRad(angle);
    const dx = Math.sin(rad) * range;
    const dy = Math.cos(rad) * range;
    points.push(toLatLng({ x: dx, y: dy }, lat, lng));
  }

  points.push([lat, lng]);
  return points;
}

// --- Visibility FOV (with building occlusion) ---

export function computeVisibilityFov(
  camera: Camera,
  buildings: BuildingPolygon[],
): [number, number][] {
  const { lat, lng, heading, fov, range } = camera;
  const halfFovRad = degToRad(fov / 2);
  const centerRad = degToRad(heading);
  const startRad = centerRad - halfFovRad;
  const endRad = centerRad + halfFovRad;

  // Step 1: Convert buildings to local coords, collect segments
  const segments: Segment[] = [];
  const rangePad = range * 1.5;

  for (const building of buildings) {
    const localCoords = building.coords.map(([bLat, bLng]) =>
      toLocal(bLat, bLng, lat, lng),
    );

    // Quick reject: skip buildings entirely outside range
    let anyInRange = false;
    for (const p of localCoords) {
      if (Math.abs(p.x) <= rangePad && Math.abs(p.y) <= rangePad) {
        anyInRange = true;
        break;
      }
    }
    if (!anyInRange) continue;

    for (let i = 0; i < localCoords.length - 1; i++) {
      const a = localCoords[i];
      const b = localCoords[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 0.01) continue;
      segments.push({ a, b });
    }
  }

  // If no nearby building segments, use simple FOV
  if (segments.length === 0) {
    return computeSimpleFov(camera);
  }

  // Step 2: Collect sample angles
  const NUM_BASE = 64;
  const EPSILON = 1e-5;
  const angles: number[] = [];

  // Regular intervals
  for (let i = 0; i <= NUM_BASE; i++) {
    angles.push(startRad + (endRad - startRad) * (i / NUM_BASE));
  }

  // Building vertex angles for crisp shadow edges
  const startPadded = startRad - degToRad(1);
  const endPadded = endRad + degToRad(1);

  for (const seg of segments) {
    for (const vertex of [seg.a, seg.b]) {
      const dist = Math.hypot(vertex.x, vertex.y);
      if (dist > rangePad || dist < 0.01) continue;

      const vertexAngle = Math.atan2(vertex.x, vertex.y);
      if (isAngleInArc(vertexAngle, startPadded, endPadded)) {
        angles.push(vertexAngle - EPSILON);
        angles.push(vertexAngle);
        angles.push(vertexAngle + EPSILON);
      }
    }
  }

  // Step 3: Filter to FOV, sort, deduplicate
  const filtered = angles.filter((a) => isAngleInArc(a, startRad, endRad));

  filtered.sort((a, b) => {
    return normalizeRadPositive(a - startRad) - normalizeRadPositive(b - startRad);
  });

  const deduped: number[] = [];
  for (const angle of filtered) {
    if (
      deduped.length === 0 ||
      Math.abs(normalizeRadPositive(angle - deduped[deduped.length - 1])) >
        EPSILON / 2
    ) {
      deduped.push(angle);
    }
  }

  // Step 4: Cast rays
  const polyPoints: [number, number][] = [[lat, lng]];

  for (const angle of deduped) {
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);

    let closestT = range;

    for (const seg of segments) {
      const t = raySegmentIntersect(
        0,
        0,
        dx,
        dy,
        seg.a.x,
        seg.a.y,
        seg.b.x,
        seg.b.y,
      );
      if (t !== null && t < closestT) {
        closestT = t;
      }
    }

    polyPoints.push(toLatLng({ x: dx * closestT, y: dy * closestT }, lat, lng));
  }

  polyPoints.push([lat, lng]);
  return polyPoints;
}

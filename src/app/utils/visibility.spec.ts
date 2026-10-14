import { describe, expect, it } from 'vitest';

import {
  computeSimpleFov,
  computeVisibilityFov,
  raySegmentIntersect,
  toLatLng,
  toLocal,
} from './visibility';

import type { Camera } from '../models/camera.model';
import type { BuildingPolygon } from '../services/building.service';

const ORIGIN_LAT = 40;
const ORIGIN_LNG = -74.5;

function makeCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'cam-1',
    name: 'Camera 1',
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    heading: 0,
    fov: 60,
    range: 50,
    ...overrides,
  };
}

/** Builds a building polygon from local (metre) coordinates around the origin. */
function buildingFromLocal(id: number, points: [number, number][]): BuildingPolygon {
  return {
    id,
    coords: points.map(([x, y]) => toLatLng({ x, y }, ORIGIN_LAT, ORIGIN_LNG)),
  };
}

function localOf([lat, lng]: [number, number]): { x: number; y: number } {
  return toLocal(lat, lng, ORIGIN_LAT, ORIGIN_LNG);
}

/** Distance in metres between the camera origin and a lat/lng point. */
function distanceFromOrigin(point: [number, number]): number {
  const p = localOf(point);
  return Math.hypot(p.x, p.y);
}

/** Compass bearing (degrees, 0 = north, clockwise, in [-180, 180]) of a point from the origin. */
function bearingFromOrigin(point: [number, number]): number {
  const p = localOf(point);
  return (Math.atan2(p.x, p.y) * 180) / Math.PI;
}

/** Arc points of a FOV polygon (strips the leading/trailing camera position). */
function arcPoints(polygon: [number, number][]): [number, number][] {
  return polygon.slice(1, -1);
}

function at(points: [number, number][], index: number): [number, number] {
  const point = points.at(index);
  if (!point) {
    throw new Error(`No point at index ${index}`);
  }
  return point;
}

describe('toLocal / toLatLng', () => {
  it('maps the origin to (0, 0)', () => {
    expect(toLocal(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_LAT, ORIGIN_LNG)).toStrictEqual({ x: 0, y: 0 });
  });

  it('maps north to +y and east to +x', () => {
    const north = toLocal(ORIGIN_LAT + 0.001, ORIGIN_LNG, ORIGIN_LAT, ORIGIN_LNG);
    const east = toLocal(ORIGIN_LAT, ORIGIN_LNG + 0.001, ORIGIN_LAT, ORIGIN_LNG);

    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeCloseTo(111.19, 1);
    expect(east.y).toBeCloseTo(0, 9);
    // Longitude degrees shrink by cos(latitude)
    expect(east.x).toBeCloseTo(111.19 * Math.cos((ORIGIN_LAT * Math.PI) / 180), 1);
  });

  it('maps south/west to negative coordinates', () => {
    const p = toLocal(ORIGIN_LAT - 0.001, ORIGIN_LNG - 0.001, ORIGIN_LAT, ORIGIN_LNG);

    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it('round-trips local coordinates back to lat/lng', () => {
    const back = localOf(toLatLng({ x: 123.4, y: -56.7 }, ORIGIN_LAT, ORIGIN_LNG));

    expect(back.x).toBeCloseTo(123.4, 6);
    expect(back.y).toBeCloseTo(-56.7, 6);
  });

  it('returns the origin for a zero offset', () => {
    expect(toLatLng({ x: 0, y: 0 }, ORIGIN_LAT, ORIGIN_LNG)).toStrictEqual([
      ORIGIN_LAT,
      ORIGIN_LNG,
    ]);
  });
});

describe('raySegmentIntersect', () => {
  it('returns the distance along the ray to a perpendicular segment', () => {
    // Ray from origin pointing north, segment y = 10 from x = -5..5
    expect(raySegmentIntersect(0, 0, 0, 1, -5, 10, 5, 10)).toBeCloseTo(10, 9);
  });

  it('scales t by the direction vector length', () => {
    expect(raySegmentIntersect(0, 0, 0, 2, -5, 10, 5, 10)).toBeCloseTo(5, 9);
  });

  it('works from a non-zero origin', () => {
    expect(raySegmentIntersect(3, 4, 1, 0, 10, 0, 10, 10)).toBeCloseTo(7, 9);
  });

  it('returns null for a segment parallel to the ray', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, 1, 0, 1, 10)).toBeNull();
  });

  it('returns null for a collinear segment', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, 0, 5, 0, 10)).toBeNull();
  });

  it('returns null for a segment behind the ray origin', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, -5, -10, 5, -10)).toBeNull();
  });

  it('returns null when the ray origin lies on the segment (t ~ 0)', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, -5, 0, 5, 0)).toBeNull();
  });

  it('returns null when the ray passes beside the segment', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, 1, 10, 5, 10)).toBeNull();
    expect(raySegmentIntersect(0, 0, 0, 1, -5, 10, -1, 10)).toBeNull();
  });

  it('counts hits exactly on either segment endpoint', () => {
    expect(raySegmentIntersect(0, 0, 0, 1, 0, 10, 5, 10)).toBeCloseTo(10, 9);
    expect(raySegmentIntersect(0, 0, 0, 1, -5, 10, 0, 10)).toBeCloseTo(10, 9);
  });

  it('is independent of segment orientation', () => {
    expect(raySegmentIntersect(0, 0, 1, 1, 10, 0, 0, 10)).toBeCloseTo(5, 9);
    expect(raySegmentIntersect(0, 0, 1, 1, 0, 10, 10, 0)).toBeCloseTo(5, 9);
  });
});

describe('computeSimpleFov', () => {
  it('returns a closed fan starting and ending at the camera', () => {
    const camera = makeCamera();
    const polygon = computeSimpleFov(camera);

    // camera + 33 arc points (32 segments) + camera
    expect(polygon).toHaveLength(35);
    expect(polygon[0]).toStrictEqual([camera.lat, camera.lng]);
    expect(polygon.at(-1)).toStrictEqual([camera.lat, camera.lng]);
  });

  it('places every arc point at the camera range', () => {
    for (const point of arcPoints(computeSimpleFov(makeCamera({ range: 80 })))) {
      expect(distanceFromOrigin(point)).toBeCloseTo(80, 6);
    }
  });

  it('spans heading +/- fov/2 in clockwise order', () => {
    const arc = arcPoints(computeSimpleFov(makeCamera({ heading: 90, fov: 60 })));

    expect(bearingFromOrigin(at(arc, 0))).toBeCloseTo(60, 6);
    expect(bearingFromOrigin(at(arc, 16))).toBeCloseTo(90, 6);
    expect(bearingFromOrigin(at(arc, -1))).toBeCloseTo(120, 6);
  });

  it('handles a full 360 degree field of view', () => {
    const arc = arcPoints(computeSimpleFov(makeCamera({ heading: 0, fov: 360 })));
    const first = at(arc, 0);
    const last = at(arc, -1);

    // Start and end of the arc coincide (both due south)
    expect(first[0]).toBeCloseTo(last[0], 9);
    expect(first[1]).toBeCloseTo(last[1], 9);
    expect(Math.abs(bearingFromOrigin(first))).toBeCloseTo(180, 6);
  });

  it('collapses to the camera point when range is zero', () => {
    const camera = makeCamera({ range: 0 });

    for (const point of computeSimpleFov(camera)) {
      expect(point[0]).toBeCloseTo(camera.lat, 12);
      expect(point[1]).toBeCloseTo(camera.lng, 12);
    }
  });
});

describe('computeVisibilityFov', () => {
  // 4 m wide box straight ahead, 10-14 m north
  const smallBox = buildingFromLocal(1, [
    [-2, 10],
    [2, 10],
    [2, 14],
    [-2, 14],
    [-2, 10],
  ]);

  it('falls back to the simple FOV when there are no buildings', () => {
    const camera = makeCamera();

    expect(computeVisibilityFov(camera, [])).toStrictEqual(computeSimpleFov(camera));
  });

  it('falls back to the simple FOV when all buildings are out of range', () => {
    const camera = makeCamera({ range: 50 });
    const farAway = buildingFromLocal(1, [
      [500, 500],
      [510, 500],
      [510, 510],
      [500, 510],
      [500, 500],
    ]);

    expect(computeVisibilityFov(camera, [farAway])).toStrictEqual(computeSimpleFov(camera));
  });

  it('falls back to the simple FOV when building segments are degenerate', () => {
    const camera = makeCamera();
    const degenerate = buildingFromLocal(1, [
      [0, 20],
      [0, 20],
      [0.001, 20],
    ]);
    const singlePoint = buildingFromLocal(2, [[0, 20]]);

    expect(computeVisibilityFov(camera, [degenerate, singlePoint])).toStrictEqual(
      computeSimpleFov(camera),
    );
  });

  it('includes a building with only one vertex inside the padded range', () => {
    const camera = makeCamera({ heading: 0, fov: 60, range: 50 });
    const wall = buildingFromLocal(1, [
      [-100, 30],
      [70, 30],
    ]);

    for (const point of arcPoints(computeVisibilityFov(camera, [wall]))) {
      expect(localOf(point).y).toBeCloseTo(30, 4);
    }
  });

  it('clips every ray to a wall that spans the whole FOV', () => {
    const camera = makeCamera({ heading: 0, fov: 60, range: 50 });
    const wall = buildingFromLocal(1, [
      [-40, 20],
      [40, 20],
      [40, 30],
      [-40, 30],
      [-40, 20],
    ]);
    const polygon = computeVisibilityFov(camera, [wall]);

    expect(polygon[0]).toStrictEqual([camera.lat, camera.lng]);
    expect(polygon.at(-1)).toStrictEqual([camera.lat, camera.lng]);
    for (const point of arcPoints(polygon)) {
      // All rays stop at the near face (y = 20)
      expect(localOf(point).y).toBeCloseTo(20, 4);
      expect(distanceFromOrigin(point)).toBeLessThan(50);
    }
  });

  it('casts a shadow behind a small building and adds crisp edge samples', () => {
    const camera = makeCamera({ heading: 0, fov: 90, range: 50 });
    const arc = arcPoints(computeVisibilityFov(camera, [smallBox]));
    const distances = arc.map(distanceFromOrigin);

    // Vertex angles add extra samples beyond the 65 base rays
    expect(arc.length).toBeGreaterThan(65);
    expect(distances.filter((d) => d < 49).length).toBeGreaterThan(0);
    expect(distances.filter((d) => Math.abs(d - 50) < 1e-6).length).toBeGreaterThan(0);

    // Rays straight ahead hit the near face at ~10 m
    const straightAhead = arc.find((p) => Math.abs(bearingFromOrigin(p)) < 1);
    expect(straightAhead).toBeDefined();
    expect(distanceFromOrigin(straightAhead ?? [0, 0])).toBeCloseTo(10, 3);

    // Rays well outside the building's angular extent reach full range
    const offAxis = arc.find((p) => Math.abs(bearingFromOrigin(p) - 40) < 1);
    expect(offAxis).toBeDefined();
    expect(distanceFromOrigin(offAxis ?? [0, 0])).toBeCloseTo(50, 6);
  });

  it('produces a sharp shadow edge at the building corner', () => {
    const camera = makeCamera({ heading: 0, fov: 90, range: 50 });
    const arc = arcPoints(computeVisibilityFov(camera, [smallBox]));
    // Corner (2, 10) is at bearing atan2(2, 10)
    const cornerBearing = (Math.atan2(2, 10) * 180) / Math.PI;
    const justInside = arc.filter((p) => {
      const b = bearingFromOrigin(p);
      return b < cornerBearing && b > cornerBearing - 0.01;
    });
    const justOutside = arc.filter((p) => {
      const b = bearingFromOrigin(p);
      return b > cornerBearing && b < cornerBearing + 0.01;
    });

    expect(justInside.length).toBeGreaterThan(0);
    expect(justOutside.length).toBeGreaterThan(0);
    for (const p of justInside) {
      expect(distanceFromOrigin(p)).toBeLessThan(11);
    }
    for (const p of justOutside) {
      // Past the near-face corner, the ray grazes the side wall and hits the far corner region
      expect(distanceFromOrigin(p)).toBeGreaterThan(10);
    }
  });

  it('returns arc points sorted clockwise from the start of the FOV', () => {
    const camera = makeCamera({ heading: 0, fov: 90, range: 50 });
    const bearings = arcPoints(computeVisibilityFov(camera, [smallBox])).map(bearingFromOrigin);

    for (let i = 1; i < bearings.length; i++) {
      expect(bearings[i]).toBeGreaterThan(bearings[i - 1] ?? Number.NEGATIVE_INFINITY);
    }
    expect(bearings[0]).toBeCloseTo(-45, 6);
    expect(bearings.at(-1)).toBeCloseTo(45, 6);
  });

  it('ignores buildings behind the camera even when they are in range', () => {
    const camera = makeCamera({ heading: 0, fov: 60, range: 50 });
    const behind = buildingFromLocal(1, [
      [-10, -20],
      [10, -20],
      [10, -30],
      [-10, -30],
      [-10, -20],
    ]);
    const polygon = computeVisibilityFov(camera, [behind]);

    // Base samples only (no vertex angles in the FOV): camera + 65 rays + camera
    expect(polygon).toHaveLength(67);
    for (const point of arcPoints(polygon)) {
      expect(distanceFromOrigin(point)).toBeCloseTo(50, 6);
    }
  });

  it('handles a FOV that wraps across north', () => {
    // heading 350, fov 60 -> spans 320..20 degrees
    const camera = makeCamera({ heading: 350, fov: 60, range: 50 });
    const box = buildingFromLocal(1, [
      [-1, 10],
      [1, 10],
      [1, 12],
      [-1, 12],
      [-1, 10],
    ]);
    const arc = arcPoints(computeVisibilityFov(camera, [box]));
    const north = arc.find((p) => Math.abs(bearingFromOrigin(p)) < 0.5);

    expect(north).toBeDefined();
    expect(distanceFromOrigin(north ?? [0, 0])).toBeCloseTo(10, 3);
    expect(bearingFromOrigin(at(arc, 0))).toBeCloseTo(-40, 6);
    expect(bearingFromOrigin(at(arc, -1))).toBeCloseTo(20, 6);
  });

  it('skips vertex angles for vertices at the camera position', () => {
    const camera = makeCamera({ heading: 0, fov: 60, range: 50 });
    // Wall starting exactly at the camera and running east (outside the FOV)
    const touching = buildingFromLocal(1, [
      [0, 0],
      [30, 0],
    ]);
    const polygon = computeVisibilityFov(camera, [touching]);

    expect(polygon).toHaveLength(67);
    for (const point of arcPoints(polygon)) {
      expect(distanceFromOrigin(point)).toBeCloseTo(50, 6);
    }
  });

  it('ignores vertex angles beyond the padded range', () => {
    const camera = makeCamera({ heading: 0, fov: 60, range: 20 });
    // Near vertex inside range keeps the building, far vertex at 100 m is not sampled
    const wall = buildingFromLocal(1, [
      [25, 5],
      [0, 100],
    ]);

    expect(() => computeVisibilityFov(camera, [wall])).not.toThrow();
    for (const point of arcPoints(computeVisibilityFov(camera, [wall]))) {
      expect(distanceFromOrigin(point)).toBeLessThanOrEqual(20 + 1e-6);
    }
  });

  it('uses the nearest of several overlapping walls', () => {
    const camera = makeCamera({ heading: 0, fov: 30, range: 50 });
    const far = buildingFromLocal(1, [
      [-40, 35],
      [40, 35],
    ]);
    const near = buildingFromLocal(2, [
      [-40, 15],
      [40, 15],
    ]);

    for (const point of arcPoints(computeVisibilityFov(camera, [far, near]))) {
      expect(localOf(point).y).toBeCloseTo(15, 4);
    }
  });

  it('deduplicates coincident sample angles', () => {
    // Vertex direction (due north) coincides with the FOV start edge and a base sample
    const camera = makeCamera({ heading: 45, fov: 90, range: 50 });
    const wall = buildingFromLocal(1, [
      [0, 20],
      [20, 20],
    ]);
    const bearings = arcPoints(computeVisibilityFov(camera, [wall])).map(bearingFromOrigin);

    expect(new Set(bearings.map((b) => b.toFixed(9))).size).toBe(bearings.length);
  });
});

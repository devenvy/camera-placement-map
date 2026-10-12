import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuildingService } from './building.service';

import type { Camera } from '../models/camera.model';

const SETTINGS_KEY = 'camera-placement-map-buildings';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

type FetchFn = typeof fetch;

function fakeResponse(init: Partial<Response>): Response {
  return init as Response;
}

function jsonResponse(body: unknown, ok = true): Response {
  return fakeResponse({ ok, json: async () => Promise.resolve(body) });
}

function invalidJsonResponse(): Response {
  return fakeResponse({ ok: true, json: async () => Promise.reject(new SyntaxError('bad json')) });
}

function makeCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'cam',
    name: 'Camera 1',
    lat: 40,
    lng: -74.5,
    heading: 0,
    fov: 60,
    range: 50,
    ...overrides,
  };
}

function way(id: number, points: [number, number][]): unknown {
  return { type: 'way', id, geometry: points.map(([lat, lon]) => ({ lat, lon })) };
}

/** Decodes the Overpass QL query from the form-encoded request body. */
function sentQuery(fetchMock: ReturnType<typeof vi.fn<FetchFn>>, call = 0): string {
  const init = fetchMock.mock.calls[call]?.[1];
  const body = typeof init?.body === 'string' ? init.body : '';
  return decodeURIComponent(body.replace(/^data=/u, ''));
}

/** Parses the bbox (south, west, north, east) out of an Overpass query. */
function sentBbox(query: string): number[] {
  const match = /\(([^)]+)\)/u.exec(query);
  return (match?.[1] ?? '').split(',').map(Number);
}

describe('BuildingService', () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn<FetchFn>().mockResolvedValue(jsonResponse({ elements: [] }));
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('settings', () => {
    it('has sensible defaults', () => {
      const service = TestBed.inject(BuildingService);

      expect(service.enabled()).toBe(false);
      expect(service.searchRadius()).toBe(150);
      expect(service.offsetX()).toBe(0);
      expect(service.offsetY()).toBe(0);
    });

    it('toggles enabled', () => {
      const service = TestBed.inject(BuildingService);

      service.setEnabled(true);
      expect(service.enabled()).toBe(true);
      service.setEnabled(false);
      expect(service.enabled()).toBe(false);
    });

    it.each([
      [5, 10],
      [10, 10],
      [250, 250],
      [1000, 1000],
      [5000, 1000],
    ])('clamps search radius %d to %d', (input, expected) => {
      const service = TestBed.inject(BuildingService);

      service.setSearchRadius(input);

      expect(service.searchRadius()).toBe(expected);
    });

    it.each([
      [-100, -50],
      [-50, -50],
      [12.5, 12.5],
      [50, 50],
      [75, 50],
    ])('clamps offsets %d to %d', (input, expected) => {
      const service = TestBed.inject(BuildingService);

      service.setOffsetX(input);
      service.setOffsetY(input);

      expect(service.offsetX()).toBe(expected);
      expect(service.offsetY()).toBe(expected);
    });

    it('persists settings to localStorage', () => {
      const service = TestBed.inject(BuildingService);
      service.setEnabled(true);
      service.setSearchRadius(300);
      service.setOffsetX(-3);
      service.setOffsetY(4);
      TestBed.tick();

      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')).toStrictEqual({
        enabled: true,
        searchRadius: 300,
        offsetX: -3,
        offsetY: 4,
      });
    });

    it('restores settings from localStorage', () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ enabled: true, searchRadius: 400, offsetX: 7, offsetY: -8 }),
      );
      const service = TestBed.inject(BuildingService);

      expect(service.enabled()).toBe(true);
      expect(service.searchRadius()).toBe(400);
      expect(service.offsetX()).toBe(7);
      expect(service.offsetY()).toBe(-8);
    });

    it('ignores stored values of the wrong type', () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ enabled: 'yes', searchRadius: '400', offsetX: null, offsetY: [] }),
      );
      const service = TestBed.inject(BuildingService);

      expect(service.enabled()).toBe(false);
      expect(service.searchRadius()).toBe(150);
      expect(service.offsetX()).toBe(0);
      expect(service.offsetY()).toBe(0);
    });

    it.each([
      ['corrupt JSON', '{oops'],
      ['a JSON primitive', '123'],
      ['JSON null', 'null'],
    ])('ignores %s in storage', (_label, raw) => {
      localStorage.setItem(SETTINGS_KEY, raw);
      const service = TestBed.inject(BuildingService);

      expect(service.enabled()).toBe(false);
      expect(service.searchRadius()).toBe(150);
    });
  });

  describe('fetchBuildingsAroundCameras', () => {
    it('returns an empty list without fetching when there are no cameras', async () => {
      const service = TestBed.inject(BuildingService);

      await expect(service.fetchBuildingsAroundCameras([])).resolves.toStrictEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs an Overpass query for buildings in a padded bbox', async () => {
      const service = TestBed.inject(BuildingService);
      service.setSearchRadius(111);

      await service.fetchBuildingsAroundCameras([makeCamera({ lat: 40, lng: -74.5 })]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe(OVERPASS_URL);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toStrictEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

      const query = sentQuery(fetchMock);
      expect(query).toMatch(/^\[out:json\]\[timeout:10\];way\["building"\]\(.+\);out geom;$/u);

      // 111 m / 111000 m/deg * 1.2 padding = 0.0012 deg
      const [south, west, north, east] = sentBbox(query);
      expect(south).toBeCloseTo(40 - 0.0012, 9);
      expect(west).toBeCloseTo(-74.5 - 0.0012, 9);
      expect(north).toBeCloseTo(40 + 0.0012, 9);
      expect(east).toBeCloseTo(-74.5 + 0.0012, 9);
    });

    it('covers all cameras in the bbox', async () => {
      const service = TestBed.inject(BuildingService);
      service.setSearchRadius(111);

      await service.fetchBuildingsAroundCameras([
        makeCamera({ lat: 40, lng: -74 }),
        makeCamera({ lat: 41, lng: -75 }),
        makeCamera({ lat: 40.5, lng: -74.5 }),
      ]);

      const [south, west, north, east] = sentBbox(sentQuery(fetchMock));
      expect(south).toBeCloseTo(40 - 0.0012, 9);
      expect(west).toBeCloseTo(-75 - 0.0012, 9);
      expect(north).toBeCloseTo(41 + 0.0012, 9);
      expect(east).toBeCloseTo(-74 + 0.0012, 9);
    });

    it('parses ways into building polygons', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          elements: [
            way(1, [
              [40, -74.5],
              [40.001, -74.5],
              [40.001, -74.499],
            ]),
            way(2, []),
          ],
        }),
      );
      const service = TestBed.inject(BuildingService);

      const buildings = await service.fetchBuildingsAroundCameras([makeCamera()]);

      expect(buildings).toStrictEqual([
        {
          id: 1,
          coords: [
            [40, -74.5],
            [40.001, -74.5],
            [40.001, -74.499],
          ],
        },
        { id: 2, coords: [] },
      ]);
    });

    it('skips elements that are not ways with geometry', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          elements: [
            null,
            'way',
            7,
            { id: 3 },
            { type: 'node', id: 4, geometry: [] },
            { type: 'relation', id: 5, members: [] },
            { type: 'way', id: 6 },
            { type: 'way', id: 7, geometry: 'nope' },
            way(8, [[1, 2]]),
          ],
        }),
      );
      const service = TestBed.inject(BuildingService);

      const buildings = await service.fetchBuildingsAroundCameras([makeCamera()]);

      expect(buildings).toStrictEqual([{ id: 8, coords: [[1, 2]] }]);
    });

    it.each([
      ['no elements field', {}],
      ['a non-array elements field', { elements: { a: 1 } }],
      ['a null body', null],
      ['a primitive body', 'text'],
    ])('returns an empty list for %s', async (_label, body) => {
      fetchMock.mockResolvedValue(jsonResponse(body));
      const service = TestBed.inject(BuildingService);

      await expect(service.fetchBuildingsAroundCameras([makeCamera()])).resolves.toStrictEqual([]);
    });

    it('returns an empty list and does not cache on HTTP errors', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
      fetchMock.mockResolvedValueOnce(jsonResponse({ elements: [way(1, [[1, 2]])] }));
      const service = TestBed.inject(BuildingService);
      const cameras = [makeCamera()];

      await expect(service.fetchBuildingsAroundCameras(cameras)).resolves.toStrictEqual([]);
      await expect(service.fetchBuildingsAroundCameras(cameras)).resolves.toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns an empty list on network errors', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const service = TestBed.inject(BuildingService);

      await expect(service.fetchBuildingsAroundCameras([makeCamera()])).resolves.toStrictEqual([]);
    });

    it('returns an empty list on invalid JSON', async () => {
      fetchMock.mockResolvedValue(invalidJsonResponse());
      const service = TestBed.inject(BuildingService);

      await expect(service.fetchBuildingsAroundCameras([makeCamera()])).resolves.toStrictEqual([]);
    });

    it('caches results per bbox (rounded to 4 decimals)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ elements: [way(1, [[1, 2]])] }));
      const service = TestBed.inject(BuildingService);

      const first = await service.fetchBuildingsAroundCameras([makeCamera({ lat: 40 })]);
      const second = await service.fetchBuildingsAroundCameras([makeCamera({ lat: 40.000001 })]);

      expect(second).toBe(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fetches again for a different bbox', async () => {
      const service = TestBed.inject(BuildingService);

      await service.fetchBuildingsAroundCameras([makeCamera({ lat: 40 })]);
      await service.fetchBuildingsAroundCameras([makeCamera({ lat: 41 })]);
      service.setSearchRadius(500);
      await service.fetchBuildingsAroundCameras([makeCamera({ lat: 41 })]);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});

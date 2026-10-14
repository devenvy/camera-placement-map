import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CameraService } from './camera.service';

import type { Camera, CameraExport } from '../models/camera.model';

const STORAGE_KEY = 'camera-placement-map-cameras';

function makeCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'cam-a',
    name: 'Camera 1',
    lat: 10,
    lng: 20,
    heading: 90,
    fov: 45,
    range: 30,
    ...overrides,
  };
}

function createService(): CameraService {
  return TestBed.inject(CameraService);
}

function storedCameras(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('CameraService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('starts empty with no selection', () => {
      const service = createService();

      expect(service.cameras()).toStrictEqual([]);
      expect(service.selectedId()).toBeNull();
      expect(service.selectedCamera()).toBeNull();
    });

    it('restores cameras from localStorage and continues numbering', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          makeCamera({ id: 'a', name: 'Camera 3' }),
          makeCamera({ id: 'b', name: 'Camera 7' }),
          makeCamera({ id: 'c', name: 'Front door' }),
        ]),
      );
      const service = createService();

      expect(service.cameras().map((c) => c.id)).toStrictEqual(['a', 'b', 'c']);
      expect(service.addCamera(0, 0).name).toBe('Camera 8');
    });

    it('starts numbering at 1 when restored cameras have custom names', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([makeCamera({ name: 'Garage' })]));
      const service = createService();

      expect(service.addCamera(0, 0).name).toBe('Camera 1');
    });

    it('ignores corrupt JSON in storage', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      const service = createService();

      expect(service.cameras()).toStrictEqual([]);
    });

    it('ignores non-array data in storage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cameras: [makeCamera()] }));
      const service = createService();

      expect(service.cameras()).toStrictEqual([]);
    });
  });

  describe('persistence', () => {
    it('writes the camera list to localStorage when it changes', () => {
      const service = createService();
      const camera = service.addCamera(1, 2);
      TestBed.tick();

      expect(storedCameras()).toStrictEqual([camera]);

      service.deleteCamera(camera.id);
      TestBed.tick();

      expect(storedCameras()).toStrictEqual([]);
    });
  });

  describe('addCamera', () => {
    it('creates a camera with defaults at the given position and selects it', () => {
      const service = createService();
      const camera = service.addCamera(51.5, -0.12);

      expect(camera).toMatchObject({
        name: 'Camera 1',
        lat: 51.5,
        lng: -0.12,
        heading: 0,
        fov: 60,
        range: 50,
      });
      expect(camera.id).toEqual(expect.any(String));
      expect(service.cameras()).toStrictEqual([camera]);
      expect(service.selectedId()).toBe(camera.id);
      expect(service.selectedCamera()).toStrictEqual(camera);
    });

    it('increments the name index and generates unique ids', () => {
      const service = createService();
      const first = service.addCamera(0, 0);
      const second = service.addCamera(0, 0);

      expect(first.name).toBe('Camera 1');
      expect(second.name).toBe('Camera 2');
      expect(first.id).not.toBe(second.id);
      expect(service.selectedId()).toBe(second.id);
    });
  });

  describe('updateCamera', () => {
    it('merges changes into the matching camera only', () => {
      const service = createService();
      const a = service.addCamera(0, 0);
      const b = service.addCamera(1, 1);

      service.updateCamera(a.id, { heading: 180, name: 'Renamed' });

      expect(service.cameras()[0]).toStrictEqual({ ...a, heading: 180, name: 'Renamed' });
      expect(service.cameras()[1]).toStrictEqual(b);
    });

    it('updates the selected camera view', () => {
      const service = createService();
      const camera = service.addCamera(0, 0);

      service.updateCamera(camera.id, { range: 99 });

      expect(service.selectedCamera()?.range).toBe(99);
    });

    it('is a no-op for an unknown id', () => {
      const service = createService();
      const camera = service.addCamera(0, 0);

      service.updateCamera('missing', { heading: 1 });

      expect(service.cameras()).toStrictEqual([camera]);
    });
  });

  describe('deleteCamera', () => {
    it('removes the camera and clears the selection if it was selected', () => {
      const service = createService();
      const camera = service.addCamera(0, 0);

      service.deleteCamera(camera.id);

      expect(service.cameras()).toStrictEqual([]);
      expect(service.selectedId()).toBeNull();
    });

    it('keeps the selection when another camera is deleted', () => {
      const service = createService();
      const a = service.addCamera(0, 0);
      const b = service.addCamera(1, 1);

      service.deleteCamera(a.id);

      expect(service.cameras()).toStrictEqual([b]);
      expect(service.selectedId()).toBe(b.id);
    });
  });

  describe('cloneCamera', () => {
    it('duplicates the camera with a new id and "(copy)" suffix and selects it', () => {
      const service = createService();
      const source = service.addCamera(5, 6);
      service.updateCamera(source.id, { heading: 45 });

      const clone = service.cloneCamera(source.id);

      expect(clone).not.toBeNull();
      expect(clone).toMatchObject({
        name: 'Camera 1 (copy)',
        lat: 5,
        lng: 6,
        heading: 45,
      });
      expect(clone?.id).not.toBe(source.id);
      expect(service.cameras()).toHaveLength(2);
      expect(service.selectedId()).toBe(clone?.id);
    });

    it('returns null for an unknown id', () => {
      const service = createService();
      service.addCamera(0, 0);

      expect(service.cloneCamera('missing')).toBeNull();
      expect(service.cameras()).toHaveLength(1);
    });
  });

  describe('selectCamera', () => {
    it('selects and deselects cameras', () => {
      const service = createService();
      const a = service.addCamera(0, 0);
      service.addCamera(1, 1);

      service.selectCamera(a.id);
      expect(service.selectedCamera()).toStrictEqual(a);

      service.selectCamera(null);
      expect(service.selectedCamera()).toBeNull();
    });

    it('yields no selected camera for an unknown id', () => {
      const service = createService();
      service.addCamera(0, 0);

      service.selectCamera('missing');

      expect(service.selectedId()).toBe('missing');
      expect(service.selectedCamera()).toBeNull();
    });
  });

  describe('exportToJson', () => {
    it('exports a versioned payload with all cameras and a timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
      try {
        const service = createService();
        const camera = service.addCamera(1, 2);
        const json = service.exportToJson();
        const parsed = JSON.parse(json) as CameraExport;

        expect(parsed).toStrictEqual({
          version: 1,
          cameras: [camera],
          exportedAt: '2026-01-02T03:04:05.000Z',
        });
        // Pretty-printed with 2-space indentation
        expect(json).toContain('\n  "version": 1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('round-trips through importFromJson', () => {
      const service = createService();
      service.addCamera(1, 2);
      service.addCamera(3, 4);
      const exported = service.exportToJson();
      const original = service.cameras();

      service.deleteCamera(original[0]?.id ?? '');
      const result = service.importFromJson(exported);

      expect(result).toStrictEqual({ success: true, count: 2 });
      expect(service.cameras()).toStrictEqual(original);
    });
  });

  describe('importFromJson', () => {
    it('imports the export format and clears the selection', () => {
      const service = createService();
      service.addCamera(0, 0);
      const cameras = [makeCamera({ id: 'x' }), makeCamera({ id: 'y', name: 'Camera 2' })];

      const result = service.importFromJson(JSON.stringify({ version: 1, cameras }));

      expect(result).toStrictEqual({ success: true, count: 2 });
      expect(service.cameras()).toStrictEqual(cameras);
      expect(service.selectedId()).toBeNull();
    });

    it('imports a bare array of cameras', () => {
      const service = createService();
      const result = service.importFromJson(JSON.stringify([makeCamera()]));

      expect(result).toStrictEqual({ success: true, count: 1 });
      expect(service.cameras()).toStrictEqual([makeCamera()]);
    });

    it('drops entries missing numeric fields', () => {
      const service = createService();
      const valid = makeCamera({ id: 'ok' });
      const entries: unknown[] = [
        valid,
        null,
        'camera',
        42,
        { ...valid, id: 'no-lat', lat: undefined },
        { ...valid, id: 'str-lng', lng: '20' },
        { ...valid, id: 'no-heading', heading: null },
        { ...valid, id: 'no-fov', fov: undefined },
        { ...valid, id: 'no-range', range: '10' },
      ];

      const result = service.importFromJson(JSON.stringify({ cameras: entries }));

      expect(result).toStrictEqual({ success: true, count: 1 });
      expect(service.cameras()).toStrictEqual([valid]);
    });

    it('assigns ids and sequential names to entries without them', () => {
      const service = createService();
      service.addCamera(0, 0); // consumes "Camera 1"
      const entries = [
        { lat: 1, lng: 2, heading: 0, fov: 60, range: 50 },
        { lat: 3, lng: 4, heading: 0, fov: 60, range: 50, id: '', name: '' },
        { lat: 5, lng: 6, heading: 0, fov: 60, range: 50, id: 'keep', name: 'Keep' },
      ];

      service.importFromJson(JSON.stringify(entries));
      const [first, second, third] = service.cameras();

      expect(first?.id).toEqual(expect.any(String));
      expect(first?.id).not.toBe('');
      expect(first?.name).toBe('Camera 2');
      expect(second?.id).not.toBe('');
      expect(second?.name).toBe('Camera 3');
      expect(third).toMatchObject({ id: 'keep', name: 'Keep' });
    });

    it('accepts an empty camera list', () => {
      const service = createService();
      service.addCamera(0, 0);

      expect(service.importFromJson('{"cameras": []}')).toStrictEqual({ success: true, count: 0 });
      expect(service.cameras()).toStrictEqual([]);
    });

    it.each([
      ['an object without cameras', '{"version": 1}'],
      ['a non-array cameras field', '{"cameras": {"a": 1}}'],
      ['a number', '42'],
      ['a string', '"cameras"'],
      ['null', 'null'],
    ])('rejects %s', (_label, json) => {
      const service = createService();
      const existing = service.addCamera(0, 0);

      expect(service.importFromJson(json)).toStrictEqual({
        success: false,
        count: 0,
        error: 'Invalid format: expected cameras array',
      });
      expect(service.cameras()).toStrictEqual([existing]);
    });

    it('rejects invalid JSON', () => {
      const service = createService();

      expect(service.importFromJson('not json')).toStrictEqual({
        success: false,
        count: 0,
        error: 'Invalid JSON',
      });
    });
  });
});

import { computed, effect, Injectable, signal } from '@angular/core';

import { type Camera, type CameraExport, createCamera } from '../models/camera.model';

const STORAGE_KEY = 'camera-placement-map-cameras';
const JSON_INDENT = 2;

function saveToStorage(cameras: Camera[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cameras));
}

@Injectable({ providedIn: 'root' })
export class CameraService {
  readonly #cameras = signal<Camera[]>([]);
  private nextIndex = 1;

  readonly cameras = this.#cameras.asReadonly();

  readonly #selectedId = signal<string | null>(null);
  readonly selectedId = this.#selectedId.asReadonly();
  readonly selectedCamera = computed(() => {
    const id = this.#selectedId();
    return this.#cameras().find((c) => c.id === id) ?? null;
  });

  constructor() {
    this.loadFromStorage();
    effect(() => {
      const cameras = this.#cameras();
      saveToStorage(cameras);
    });
  }

  addCamera(lat: number, lng: number): Camera {
    const camera = createCamera(lat, lng, this.nextIndex++);
    this.#cameras.update((prev) => [...prev, camera]);
    this.#selectedId.set(camera.id);
    return camera;
  }

  updateCamera(id: string, changes: Partial<Omit<Camera, 'id'>>): void {
    this.#cameras.update((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  }

  deleteCamera(id: string): void {
    this.#cameras.update((prev) => prev.filter((c) => c.id !== id));
    if (this.#selectedId() === id) {
      this.#selectedId.set(null);
    }
  }

  cloneCamera(id: string): Camera | null {
    const source = this.#cameras().find((c) => c.id === id);
    if (!source) {
      return null;
    }
    const clone: Camera = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
    };
    this.#cameras.update((prev) => [...prev, clone]);
    this.#selectedId.set(clone.id);
    return clone;
  }

  selectCamera(id: string | null): void {
    this.#selectedId.set(id);
  }

  exportToJson(): string {
    const data: CameraExport = {
      version: 1,
      cameras: this.#cameras(),
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, JSON_INDENT);
  }

  importFromJson(json: string): {
    success: boolean;
    count: number;
    error?: string;
  } {
    try {
      const data: unknown = JSON.parse(json);
      const cameras: unknown =
        Array.isArray(data) || typeof data !== 'object' || data === null || !('cameras' in data)
          ? data
          : data.cameras;
      if (!Array.isArray(cameras)) {
        return {
          success: false,
          count: 0,
          error: 'Invalid format: expected cameras array',
        };
      }
      const entries: unknown[] = cameras;
      const validated = entries.filter(
        (c): c is Camera =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as Camera).lat === 'number' &&
          typeof (c as Camera).lng === 'number' &&
          typeof (c as Camera).heading === 'number' &&
          typeof (c as Camera).fov === 'number' &&
          typeof (c as Camera).range === 'number',
      );
      for (const cam of validated) {
        if (!cam.id) {
          cam.id = crypto.randomUUID();
        }
        if (!cam.name) {
          cam.name = `Camera ${this.nextIndex++}`;
        }
      }
      this.#cameras.set(validated);
      this.#selectedId.set(null);
      return { success: true, count: validated.length };
    } catch {
      return { success: false, count: 0, error: 'Invalid JSON' };
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cameras = parsed as Camera[];
        this.#cameras.set(cameras);
        const maxIndex = cameras.reduce((max, c) => {
          const digits = c.name.match(/Camera (\d+)/)?.[1];
          return digits ? Math.max(max, parseInt(digits, 10)) : max;
        }, 0);
        this.nextIndex = maxIndex + 1;
      }
    } catch {
      // Ignore corrupt storage
    }
  }
}

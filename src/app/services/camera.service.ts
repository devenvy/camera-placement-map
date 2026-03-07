import { Injectable, signal, computed, effect } from '@angular/core';
import { Camera, createCamera, CameraExport } from '../models/camera.model';

const STORAGE_KEY = 'camera-placement-map-cameras';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private readonly _cameras = signal<Camera[]>([]);
  private _nextIndex = 1;

  readonly cameras = this._cameras.asReadonly();

  private readonly _selectedId = signal<string | null>(null);
  readonly selectedId = this._selectedId.asReadonly();
  readonly selectedCamera = computed(() => {
    const id = this._selectedId();
    return this._cameras().find((c) => c.id === id) ?? null;
  });

  constructor() {
    this.loadFromStorage();
    effect(() => {
      const cameras = this._cameras();
      this.saveToStorage(cameras);
    });
  }

  addCamera(lat: number, lng: number): Camera {
    const camera = createCamera(lat, lng, this._nextIndex++);
    this._cameras.update((prev) => [...prev, camera]);
    this._selectedId.set(camera.id);
    return camera;
  }

  updateCamera(id: string, changes: Partial<Omit<Camera, 'id'>>): void {
    this._cameras.update((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...changes } : c)),
    );
  }

  deleteCamera(id: string): void {
    this._cameras.update((prev) => prev.filter((c) => c.id !== id));
    if (this._selectedId() === id) {
      this._selectedId.set(null);
    }
  }

  selectCamera(id: string | null): void {
    this._selectedId.set(id);
  }

  exportToJson(): string {
    const data: CameraExport = {
      version: 1,
      cameras: this._cameras(),
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  }

  importFromJson(json: string): {
    success: boolean;
    count: number;
    error?: string;
  } {
    try {
      const data = JSON.parse(json);
      const cameras: unknown[] = Array.isArray(data) ? data : data?.cameras;
      if (!Array.isArray(cameras)) {
        return {
          success: false,
          count: 0,
          error: 'Invalid format: expected cameras array',
        };
      }
      const validated = cameras.filter(
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
        if (!cam.id) cam.id = crypto.randomUUID();
        if (!cam.name) cam.name = `Camera ${this._nextIndex++}`;
      }
      this._cameras.set(validated);
      this._selectedId.set(null);
      return { success: true, count: validated.length };
    } catch {
      return { success: false, count: 0, error: 'Invalid JSON' };
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cameras = JSON.parse(raw);
      if (Array.isArray(cameras)) {
        this._cameras.set(cameras);
        const maxIndex = cameras.reduce((max: number, c: Camera) => {
          const match = c.name.match(/Camera (\d+)/);
          return match ? Math.max(max, parseInt(match[1], 10)) : max;
        }, 0);
        this._nextIndex = maxIndex + 1;
      }
    } catch {
      // Ignore corrupt storage
    }
  }

  private saveToStorage(cameras: Camera[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cameras));
  }
}

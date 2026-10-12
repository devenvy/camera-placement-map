import { effect, Injectable, signal } from '@angular/core';

import type { Camera } from '../models/camera.model';

export interface BuildingPolygon {
  id: number;
  coords: [number, number][];
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SETTINGS_KEY = 'camera-placement-map-buildings';

const DEFAULT_SEARCH_RADIUS_M = 150;
const MIN_SEARCH_RADIUS_M = 10;
const MAX_SEARCH_RADIUS_M = 1000;
const MAX_OFFSET_M = 50;
const METERS_PER_DEGREE = 111_000;
const BBOX_PADDING_FACTOR = 1.2;
const CACHE_KEY_DECIMALS = 4;

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  id: number;
  geometry: OverpassPoint[];
}

function isOverpassWay(element: unknown): element is OverpassWay {
  return (
    typeof element === 'object' &&
    element !== null &&
    'type' in element &&
    element.type === 'way' &&
    'geometry' in element &&
    Array.isArray(element.geometry)
  );
}

function getOverpassElements(data: unknown): unknown[] {
  if (
    typeof data === 'object' &&
    data !== null &&
    'elements' in data &&
    Array.isArray(data.elements)
  ) {
    return data.elements;
  }
  return [];
}

interface BuildingSettings {
  enabled: boolean;
  searchRadius: number;
  offsetX: number;
  offsetY: number;
}

@Injectable({ providedIn: 'root' })
export class BuildingService {
  private readonly cache = new Map<string, BuildingPolygon[]>();

  readonly #enabled = signal(false);
  readonly enabled = this.#enabled.asReadonly();

  readonly #searchRadius = signal(DEFAULT_SEARCH_RADIUS_M);
  readonly searchRadius = this.#searchRadius.asReadonly();

  readonly #offsetX = signal(0);
  readonly offsetX = this.#offsetX.asReadonly();

  readonly #offsetY = signal(0);
  readonly offsetY = this.#offsetY.asReadonly();

  constructor() {
    this.loadSettings();
    effect(() => {
      const settings: BuildingSettings = {
        enabled: this.#enabled(),
        searchRadius: this.#searchRadius(),
        offsetX: this.#offsetX(),
        offsetY: this.#offsetY(),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
  }

  setEnabled(value: boolean): void {
    this.#enabled.set(value);
  }

  setSearchRadius(value: number): void {
    this.#searchRadius.set(Math.max(MIN_SEARCH_RADIUS_M, Math.min(MAX_SEARCH_RADIUS_M, value)));
  }

  setOffsetX(value: number): void {
    this.#offsetX.set(Math.max(-MAX_OFFSET_M, Math.min(MAX_OFFSET_M, value)));
  }

  setOffsetY(value: number): void {
    this.#offsetY.set(Math.max(-MAX_OFFSET_M, Math.min(MAX_OFFSET_M, value)));
  }

  async fetchBuildingsAroundCameras(cameras: Camera[]): Promise<BuildingPolygon[]> {
    if (cameras.length === 0) {
      return [];
    }

    const radius = this.#searchRadius();
    const padDeg = (radius / METERS_PER_DEGREE) * BBOX_PADDING_FACTOR;

    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;

    for (const camera of cameras) {
      south = Math.min(south, camera.lat - padDeg);
      west = Math.min(west, camera.lng - padDeg);
      north = Math.max(north, camera.lat + padDeg);
      east = Math.max(east, camera.lng + padDeg);
    }

    return this.fetchBuildings(south, west, north, east);
  }

  private async fetchBuildings(
    south: number,
    west: number,
    north: number,
    east: number,
  ): Promise<BuildingPolygon[]> {
    const key = `${south.toFixed(CACHE_KEY_DECIMALS)},${west.toFixed(CACHE_KEY_DECIMALS)},${north.toFixed(CACHE_KEY_DECIMALS)},${east.toFixed(CACHE_KEY_DECIMALS)}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const query = `[out:json][timeout:10];way["building"](${south},${west},${north},${east});out geom;`;

    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.ok) {
        return [];
      }

      const data: unknown = await response.json();
      const buildings: BuildingPolygon[] = [];

      for (const element of getOverpassElements(data)) {
        if (isOverpassWay(element)) {
          buildings.push({
            id: element.id,
            coords: element.geometry.map((p) => [p.lat, p.lon] as [number, number]),
          });
        }
      }

      this.cache.set(key, buildings);
      return buildings;
    } catch {
      return [];
    }
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }
      const settings = parsed as Partial<Record<keyof BuildingSettings, unknown>>;
      if (typeof settings.enabled === 'boolean') {
        this.#enabled.set(settings.enabled);
      }
      if (typeof settings.searchRadius === 'number') {
        this.#searchRadius.set(settings.searchRadius);
      }
      if (typeof settings.offsetX === 'number') {
        this.#offsetX.set(settings.offsetX);
      }
      if (typeof settings.offsetY === 'number') {
        this.#offsetY.set(settings.offsetY);
      }
    } catch {
      // Ignore corrupt settings
    }
  }
}

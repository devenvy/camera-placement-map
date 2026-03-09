import { Injectable, signal, effect } from '@angular/core';
import { Camera } from '../models/camera.model';

export interface BuildingPolygon {
  id: number;
  coords: [number, number][];
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SETTINGS_KEY = 'camera-placement-map-buildings';

interface BuildingSettings {
  enabled: boolean;
  searchRadius: number;
  offsetX: number;
  offsetY: number;
}

@Injectable({ providedIn: 'root' })
export class BuildingService {
  private cache = new Map<string, BuildingPolygon[]>();

  private readonly _enabled = signal(false);
  readonly enabled = this._enabled.asReadonly();

  private readonly _searchRadius = signal(150);
  readonly searchRadius = this._searchRadius.asReadonly();

  private readonly _offsetX = signal(0);
  readonly offsetX = this._offsetX.asReadonly();

  private readonly _offsetY = signal(0);
  readonly offsetY = this._offsetY.asReadonly();

  constructor() {
    this.loadSettings();
    effect(() => {
      const settings: BuildingSettings = {
        enabled: this._enabled(),
        searchRadius: this._searchRadius(),
        offsetX: this._offsetX(),
        offsetY: this._offsetY(),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
  }

  setEnabled(value: boolean): void {
    this._enabled.set(value);
  }

  setSearchRadius(value: number): void {
    this._searchRadius.set(Math.max(10, Math.min(1000, value)));
  }

  setOffsetX(value: number): void {
    this._offsetX.set(Math.max(-50, Math.min(50, value)));
  }

  setOffsetY(value: number): void {
    this._offsetY.set(Math.max(-50, Math.min(50, value)));
  }

  async fetchBuildingsAroundCameras(
    cameras: Camera[],
  ): Promise<BuildingPolygon[]> {
    if (cameras.length === 0) return [];

    const radius = this._searchRadius();
    const padDeg = (radius / 111000) * 1.2;

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
    const key = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const query = `[out:json][timeout:10];way["building"](${south},${west},${north},${east});out geom;`;

    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const buildings: BuildingPolygon[] = [];

      for (const element of data.elements ?? []) {
        if (element.type === 'way' && element.geometry) {
          buildings.push({
            id: element.id,
            coords: element.geometry.map(
              (p: { lat: number; lon: number }) => [p.lat, p.lon] as [number, number],
            ),
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
      if (!raw) return;
      const settings: BuildingSettings = JSON.parse(raw);
      if (typeof settings.enabled === 'boolean') {
        this._enabled.set(settings.enabled);
      }
      if (typeof settings.searchRadius === 'number') {
        this._searchRadius.set(settings.searchRadius);
      }
      if (typeof settings.offsetX === 'number') {
        this._offsetX.set(settings.offsetX);
      }
      if (typeof settings.offsetY === 'number') {
        this._offsetY.set(settings.offsetY);
      }
    } catch {
      // Ignore corrupt settings
    }
  }
}

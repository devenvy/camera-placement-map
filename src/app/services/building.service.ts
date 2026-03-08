import { Injectable } from '@angular/core';

export interface BuildingPolygon {
  id: number;
  coords: [number, number][];
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MIN_ZOOM = 16;

@Injectable({ providedIn: 'root' })
export class BuildingService {
  private cache = new Map<string, BuildingPolygon[]>();

  canFetch(zoom: number): boolean {
    return zoom >= MIN_ZOOM;
  }

  async fetchBuildings(
    south: number,
    west: number,
    north: number,
    east: number,
  ): Promise<BuildingPolygon[]> {
    const key = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const query = `[out:json][timeout:10];way["building"](${south},${west},${north},${east});out geom;`;

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
          coords: element.geometry.map((p: { lat: number; lon: number }) => [
            p.lat,
            p.lon,
          ]),
        });
      }
    }

    this.cache.set(key, buildings);
    return buildings;
  }
}

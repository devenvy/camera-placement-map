import {
  Component,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
  effect,
  untracked,
  NgZone,
} from '@angular/core';
import * as L from 'leaflet';
import { GeoSearchControl, OpenStreetMapProvider } from 'leaflet-geosearch';
import { Camera } from '../../models/camera.model';
import { CameraService } from '../../services/camera.service';
import {
  BuildingService,
  BuildingPolygon,
} from '../../services/building.service';
import { SettingsService } from '../../services/settings.service';
import {
  computeSimpleFov,
  computeVisibilityFov,
} from '../../utils/visibility';

const CAMERA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

const FOV_COLOR = '#38bdf8';
const FOV_SELECTED_COLOR = '#facc15';

@Component({
  selector: 'app-map',
  templateUrl: './map.html',
  styleUrl: './map.css',
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  mapContainer!: ElementRef<HTMLDivElement>;

  private cameraService = inject(CameraService);
  private buildingService = inject(BuildingService);
  private settingsService = inject(SettingsService);
  private zone = inject(NgZone);
  private map!: L.Map;
  private cameraLayers = new Map<
    string,
    { marker: L.Marker; fov: L.Polygon }
  >();
  private resizeObserver?: ResizeObserver;
  private buildingLayer = L.layerGroup();
  private cachedBuildings: BuildingPolygon[] = [];
  private layerControl?: L.Control.Layers;

  constructor() {
    effect(() => {
      const cameras = this.cameraService.cameras();
      if (this.map) {
        this.syncCamerasToMap(cameras);
        if (this.buildingService.enabled()) {
          this.loadBuildings();
        }
      }
    });

    effect(() => {
      const selectedId = this.cameraService.selectedId();
      if (this.map) {
        untracked(() => {
          this.highlightSelected(selectedId);
          this.flyToCamera(selectedId);
        });
      }
    });

    // React to building settings changes
    effect(() => {
      const enabled = this.buildingService.enabled();
      const _radius = this.buildingService.searchRadius();
      if (this.map) {
        if (enabled) {
          if (!this.map.hasLayer(this.buildingLayer)) {
            this.buildingLayer.addTo(this.map);
          }
          this.loadBuildings();
        } else {
          this.map.removeLayer(this.buildingLayer);
          this.buildingLayer.clearLayers();
          this.cachedBuildings = [];
          this.recomputeAllFovs();
        }
      }
    });

    // React to building offset changes
    effect(() => {
      const _ox = this.buildingService.offsetX();
      const _oy = this.buildingService.offsetY();
      if (this.map && this.buildingService.enabled()) {
        untracked(() => this.renderBuildings());
      }
    });

    // React to tile provider API key changes
    effect(() => {
      const _g = this.settingsService.googleApiKey();
      const _m = this.settingsService.mapboxToken();
      const _b = this.settingsService.bingApiKey();
      if (this.map) {
        untracked(() => this.rebuildLayerControl());
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
    const cameras = this.cameraService.cameras();
    this.syncCamerasToMap(cameras);
    this.fitBoundsToAll(cameras);

    // Restore buildings if previously enabled
    if (this.buildingService.enabled()) {
      this.buildingLayer.addTo(this.map);
      this.loadBuildings();
    }
  }

  getCenter(): { lat: number; lng: number } {
    const center = this.map.getCenter();
    return { lat: center.lat, lng: center.lng };
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [40.0, -74.5],
      zoom: 18,
      zoomControl: true,
    });

    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxNativeZoom: 19,
        maxZoom: 22,
      },
    );

    satellite.addTo(this.map);
    this.rebuildLayerControl();

    const searchControl = GeoSearchControl({
      provider: new OpenStreetMapProvider(),
      style: 'bar',
      autoComplete: true,
      autoCompleteDelay: 250,
      showMarker: false,
      showPopup: false,
      searchLabel: 'Search for an address...',
    });
    this.map.addControl(searchControl);

    this.resizeObserver = new ResizeObserver(() => {
      this.map.invalidateSize();
    });
    this.resizeObserver.observe(this.mapContainer.nativeElement);
  }

  private rebuildLayerControl(): void {
    if (this.layerControl) {
      this.map.removeControl(this.layerControl);
    }

    const baseLayers: Record<string, L.TileLayer> = {
      'Satellite (Esri)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxNativeZoom: 19, maxZoom: 22 },
      ),
      Street: L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxNativeZoom: 19,
          maxZoom: 22,
        },
      ),
    };

    const googleKey = this.settingsService.googleApiKey();
    if (googleKey) {
      baseLayers['Google Satellite'] = L.tileLayer(
        `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${googleKey}`,
        { attribution: '&copy; Google', maxNativeZoom: 20, maxZoom: 22 },
      );
    }

    const mapboxToken = this.settingsService.mapboxToken();
    if (mapboxToken) {
      baseLayers['Mapbox Satellite'] = L.tileLayer(
        `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
        {
          attribution: '&copy; Mapbox',
          maxNativeZoom: 20,
          maxZoom: 22,
          tileSize: 512,
          zoomOffset: -1,
        },
      );
    }

    const bingKey = this.settingsService.bingApiKey();
    if (bingKey) {
      baseLayers['Bing Aerial'] = new BingTileLayer(bingKey);
    }

    this.layerControl = L.control.layers(baseLayers, {}, { position: 'topright' });
    this.layerControl.addTo(this.map);
  }

  private syncCamerasToMap(cameras: Camera[]): void {
    const currentIds = new Set(cameras.map((c) => c.id));

    for (const [id, layers] of this.cameraLayers) {
      if (!currentIds.has(id)) {
        this.map.removeLayer(layers.marker);
        this.map.removeLayer(layers.fov);
        this.cameraLayers.delete(id);
      }
    }

    for (const camera of cameras) {
      const existing = this.cameraLayers.get(camera.id);
      if (existing) {
        existing.marker.setLatLng([camera.lat, camera.lng]);
        existing.marker.setIcon(this.createIcon(camera));
        existing.fov.setLatLngs(this.computeFovForCamera(camera));
      } else {
        this.addCameraToMap(camera);
      }
    }
  }

  private addCameraToMap(camera: Camera): void {
    const icon = this.createIcon(camera);

    const marker = L.marker([camera.lat, camera.lng], {
      icon,
      draggable: true,
    });

    marker.on('drag', (e: L.LeafletEvent) => {
      const pos = (e.target as L.Marker).getLatLng();
      const fovLayer = this.cameraLayers.get(camera.id)?.fov;
      if (fovLayer) {
        const current = this.cameraService
          .cameras()
          .find((c) => c.id === camera.id);
        if (current) {
          fovLayer.setLatLngs(
            this.computeFovForCamera(
              { ...current, lat: pos.lat, lng: pos.lng },
              true,
            ),
          );
        }
      }
    });

    marker.on('dragend', (e: L.DragEndEvent) => {
      const pos = (e.target as L.Marker).getLatLng();
      this.zone.run(() => {
        this.cameraService.updateCamera(camera.id, {
          lat: pos.lat,
          lng: pos.lng,
        });
      });
    });

    marker.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      this.zone.run(() => {
        this.cameraService.selectCamera(camera.id);
      });
    });

    const selectedId = this.cameraService.selectedId();
    const isSelected = camera.id === selectedId;
    const color = isSelected ? FOV_SELECTED_COLOR : FOV_COLOR;

    const fov = L.polygon(this.computeFovForCamera(camera), {
      color,
      fillColor: color,
      fillOpacity: 0.2,
      weight: isSelected ? 2 : 1,
    });

    fov.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      this.zone.run(() => {
        this.cameraService.selectCamera(camera.id);
      });
    });

    marker.addTo(this.map);
    fov.addTo(this.map);
    this.cameraLayers.set(camera.id, { marker, fov });
  }

  private createIcon(camera: Camera): L.DivIcon {
    const selected = this.cameraService.selectedId() === camera.id;
    return L.divIcon({
      className: '',
      html: `<div class="camera-marker${selected ? ' selected' : ''}" style="transform: rotate(${camera.heading}deg)">${CAMERA_SVG}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  private highlightSelected(selectedId: string | null): void {
    for (const [id, layers] of this.cameraLayers) {
      const isSelected = id === selectedId;
      const color = isSelected ? FOV_SELECTED_COLOR : FOV_COLOR;
      layers.fov.setStyle({
        color,
        fillColor: color,
        fillOpacity: isSelected ? 0.3 : 0.2,
        weight: isSelected ? 2 : 1,
      });
      layers.marker.setZIndexOffset(isSelected ? 1000 : 0);
      const camera = this.cameraService.cameras().find((c) => c.id === id);
      if (camera) {
        layers.marker.setIcon(this.createIcon(camera));
      }
    }
  }

  private flyToCamera(selectedId: string | null): void {
    if (!selectedId) return;
    const camera = this.cameraService
      .cameras()
      .find((c) => c.id === selectedId);
    if (camera) {
      this.map.flyTo(
        [camera.lat, camera.lng],
        Math.max(this.map.getZoom(), 18),
        { duration: 0.5 },
      );
    }
  }

  private fitBoundsToAll(cameras: Camera[]): void {
    if (cameras.length === 0) return;
    const bounds = L.latLngBounds(
      cameras.map((c) => [c.lat, c.lng] as L.LatLngTuple),
    );
    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 19 });
  }

  private async loadBuildings(): Promise<void> {
    const cameras = this.cameraService.cameras();
    if (cameras.length === 0) {
      this.buildingLayer.clearLayers();
      this.cachedBuildings = [];
      return;
    }

    const buildings =
      await this.buildingService.fetchBuildingsAroundCameras(cameras);

    this.cachedBuildings = buildings;
    this.renderBuildings();
  }

  private renderBuildings(): void {
    const ox = this.buildingService.offsetX();
    const oy = this.buildingService.offsetY();

    this.buildingLayer.clearLayers();
    for (const building of this.cachedBuildings) {
      const coords = this.applyBuildingOffset(building.coords, ox, oy);
      L.polygon(coords, {
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.08,
        weight: 1.5,
        interactive: false,
      }).addTo(this.buildingLayer);
    }

    this.recomputeAllFovs();
  }

  private applyBuildingOffset(
    coords: [number, number][],
    ox: number,
    oy: number,
  ): [number, number][] {
    if (ox === 0 && oy === 0) return coords;
    const latShift = oy / 111320;
    return coords.map(([lat, lng]) => {
      const lngShift = ox / (111320 * Math.cos(lat * (Math.PI / 180)));
      return [lat + latShift, lng + lngShift] as [number, number];
    });
  }

  private recomputeAllFovs(): void {
    const cameras = this.cameraService.cameras();
    for (const camera of cameras) {
      const existing = this.cameraLayers.get(camera.id);
      if (existing) {
        existing.fov.setLatLngs(this.computeFovForCamera(camera));
      }
    }
  }

  private computeFovForCamera(
    camera: Camera,
    useSimple = false,
  ): L.LatLngExpression[] {
    if (
      useSimple ||
      !this.buildingService.enabled() ||
      this.cachedBuildings.length === 0
    ) {
      return computeSimpleFov(camera);
    }
    const ox = this.buildingService.offsetX();
    const oy = this.buildingService.offsetY();
    const offsetBuildings =
      ox === 0 && oy === 0
        ? this.cachedBuildings
        : this.cachedBuildings.map((b) => ({
            ...b,
            coords: this.applyBuildingOffset(b.coords, ox, oy),
          }));
    return computeVisibilityFov(camera, offsetBuildings);
  }
}

// Bing Maps uses quadkey tile addressing instead of {z}/{x}/{y}
class BingTileLayer extends L.TileLayer {
  constructor(apiKey: string) {
    super(
      `https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=14205&key=${apiKey}`,
      {
        attribution: '&copy; Microsoft',
        subdomains: ['0', '1', '2', '3'],
        maxNativeZoom: 19,
        maxZoom: 22,
      },
    );
  }

  override getTileUrl(coords: L.Coords): string {
    const quadkey = this.toQuadKey(coords.x, coords.y, coords.z);
    return super.getTileUrl(coords).replace('{q}', quadkey);
  }

  private toQuadKey(x: number, y: number, z: number): string {
    let key = '';
    for (let i = z; i > 0; i--) {
      let digit = 0;
      const mask = 1 << (i - 1);
      if ((x & mask) !== 0) digit += 1;
      if ((y & mask) !== 0) digit += 2;
      key += digit;
    }
    return key;
  }
}

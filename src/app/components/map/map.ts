import {
  Component,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
  effect,
  NgZone,
} from '@angular/core';
import * as L from 'leaflet';
import { GeoSearchControl, OpenStreetMapProvider } from 'leaflet-geosearch';
import { Camera } from '../../models/camera.model';
import { CameraService } from '../../services/camera.service';

const CAMERA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

const FOV_COLOR = '#38bdf8';
const FOV_SELECTED_COLOR = '#facc15';

@Component({
  selector: 'app-map',
  templateUrl: './map.html',
  styleUrl: './map.css',
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  private cameraService = inject(CameraService);
  private zone = inject(NgZone);
  private map!: L.Map;
  private cameraLayers = new Map<
    string,
    { marker: L.Marker; fov: L.Polygon }
  >();
  private resizeObserver?: ResizeObserver;
  private addingBlocked = false;

  ngAfterViewInit(): void {
    this.initMap();

    effect(() => {
      this.syncCamerasToMap(this.cameraService.cameras());
    });

    effect(() => {
      this.highlightSelected(this.cameraService.selectedId());
    });
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
        maxZoom: 19,
      },
    );

    const street = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      },
    );

    satellite.addTo(this.map);

    L.control
      .layers(
        { Satellite: satellite, Street: street },
        {},
        { position: 'topright' },
      )
      .addTo(this.map);

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

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.addingBlocked) {
        this.addingBlocked = false;
        return;
      }
      this.zone.run(() => {
        this.cameraService.addCamera(e.latlng.lat, e.latlng.lng);
      });
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.map.invalidateSize();
    });
    this.resizeObserver.observe(this.mapContainer.nativeElement);
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
        existing.fov.setLatLngs(this.computeFovPolygon(camera));
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
            this.computeFovPolygon({ ...current, lat: pos.lat, lng: pos.lng }),
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
      this.addingBlocked = true;
      this.zone.run(() => {
        this.cameraService.selectCamera(camera.id);
      });
    });

    const selectedId = this.cameraService.selectedId();
    const isSelected = camera.id === selectedId;
    const color = isSelected ? FOV_SELECTED_COLOR : FOV_COLOR;

    const fov = L.polygon(this.computeFovPolygon(camera), {
      color,
      fillColor: color,
      fillOpacity: 0.2,
      weight: isSelected ? 2 : 1,
    });

    fov.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      this.addingBlocked = true;
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
      // Update icon to reflect selection
      const camera = this.cameraService
        .cameras()
        .find((c) => c.id === id);
      if (camera) {
        layers.marker.setIcon(this.createIcon(camera));
      }
    }
  }

  private computeFovPolygon(camera: Camera): L.LatLngExpression[] {
    const points: L.LatLngExpression[] = [];
    const { lat, lng, heading, fov, range } = camera;

    points.push([lat, lng]);

    const segments = 32;
    const startAngle = heading - fov / 2;
    const endAngle = heading + fov / 2;
    const step = (endAngle - startAngle) / segments;

    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + step * i;
      points.push(this.destinationPoint(lat, lng, range, angle));
    }

    points.push([lat, lng]);
    return points;
  }

  private destinationPoint(
    lat: number,
    lng: number,
    distanceMeters: number,
    bearingDeg: number,
  ): [number, number] {
    const R = 6371000;
    const d = distanceMeters / R;
    const brng = (bearingDeg * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lng1 = (lng * Math.PI) / 180;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );

    return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
  }
}

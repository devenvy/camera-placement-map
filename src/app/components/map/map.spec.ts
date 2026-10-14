import { type ComponentFixture, TestBed } from '@angular/core/testing';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { MapComponent } from './map';
import { type BuildingPolygon, BuildingService } from '../../services/building.service';
import { CameraService } from '../../services/camera.service';
import { SettingsService } from '../../services/settings.service';
import { computeSimpleFov, toLatLng } from '../../utils/visibility';

import type { Camera } from '../../models/camera.model';

type FetchFn = typeof fetch;

const CONTAINER_WIDTH = 800;
const CONTAINER_HEIGHT = 600;
const FOV_COLOR = '#38bdf8';
const FOV_SELECTED_COLOR = '#facc15';

class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn<(target: Element) => void>();
  readonly disconnect = vi.fn<() => void>();
  readonly unobserve = vi.fn<(target: Element) => void>();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this);
  }
}

function notFound(): Response {
  return { ok: false } as Partial<Response> as Response;
}

/** A square building centred `northMetres` north of the given camera position. */
function buildingNorthOf(camera: Camera, northMetres: number, id = 1): BuildingPolygon {
  const half = 3;
  const corners: [number, number][] = [
    [-half, northMetres - half],
    [half, northMetres - half],
    [half, northMetres + half],
    [-half, northMetres + half],
    [-half, northMetres - half],
  ];
  return {
    id,
    coords: corners.map(([x, y]) => toLatLng({ x, y }, camera.lat, camera.lng)),
  };
}

interface CameraLayers {
  marker: L.Marker;
  fov: L.Polygon;
}

/** Private state of MapComponent that the tests inspect. */
interface MapInternals {
  mapInstance?: L.Map;
  cameraLayers: Map<string, CameraLayers>;
  buildingLayer: L.LayerGroup;
  cachedBuildings: BuildingPolygon[];
  renderBuildings: () => void;
  highlightSelected: (selectedId: string | null) => void;
  recomputeAllFovs: () => void;
}

function internals(component: MapComponent): MapInternals {
  return component as unknown as MapInternals;
}

function latLngsOf(polygon: L.Polygon): L.LatLng[] {
  const rings = polygon.getLatLngs();
  const first = rings[0];
  return Array.isArray(first) ? (first as L.LatLng[]) : (rings as L.LatLng[]);
}

describe('MapComponent', () => {
  let fixture: ComponentFixture<MapComponent>;
  let component: MapComponent;
  let cameraService: CameraService;
  let buildingService: BuildingService;
  let settingsService: SettingsService;
  let fetchBuildings: MockInstance<BuildingService['fetchBuildingsAroundCameras']>;

  function map(): L.Map {
    const instance = internals(component).mapInstance;
    if (!instance) {
      throw new Error('Map not initialized');
    }
    return instance;
  }

  function layersFor(id: string): CameraLayers {
    const layers = internals(component).cameraLayers.get(id);
    if (!layers) {
      throw new Error(`No layers for camera ${id}`);
    }
    return layers;
  }

  function buildingPolygons(): L.Polygon[] {
    return internals(component).buildingLayer.getLayers() as L.Polygon[];
  }

  function firstBuilding(): L.Polygon {
    const polygon = buildingPolygons()[0];
    if (!polygon) {
      throw new Error('No building rendered');
    }
    return polygon;
  }

  function baseLayerNames(): string[] {
    const container = map().getContainer();
    return Array.from(
      container.querySelectorAll('.leaflet-control-layers-base label span span'),
    ).map((el) => el.textContent.trim());
  }

  async function settle(): Promise<void> {
    TestBed.tick();
    await fixture.whenStable();
    // Allow async building loads to resolve
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    TestBed.tick();
  }

  async function init(): Promise<void> {
    fixture.detectChanges();
    await settle();
    // Avoid Leaflet fly animations in jsdom
    vi.spyOn(map(), 'flyTo').mockImplementation(() => map());
  }

  beforeEach(async () => {
    localStorage.clear();
    FakeResizeObserver.instances.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockResolvedValue(notFound()));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(CONTAINER_WIDTH);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(CONTAINER_HEIGHT);

    await TestBed.configureTestingModule({ imports: [MapComponent] }).compileComponents();
    cameraService = TestBed.inject(CameraService);
    buildingService = TestBed.inject(BuildingService);
    settingsService = TestBed.inject(SettingsService);
    fetchBuildings = vi.spyOn(buildingService, 'fetchBuildingsAroundCameras').mockResolvedValue([]);
    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('before initialization', () => {
    it('throws when the map is accessed before the view is ready', () => {
      expect(() => component.getCenter()).toThrow('Map not initialized');
    });

    it('can be destroyed without having been initialized', () => {
      expect(() => {
        component.ngOnDestroy();
      }).not.toThrow();
    });
  });

  describe('initialization', () => {
    it('creates a Leaflet map centred on the default location', async () => {
      await init();

      expect(component.getCenter()).toStrictEqual({ lat: 40, lng: -74.5 });
      expect(map().getZoom()).toBe(18);
    });

    it('adds the satellite base layer, layer control and search control', async () => {
      await init();
      const container = map().getContainer();

      expect(container.querySelector('.leaflet-control-layers')).not.toBeNull();
      expect(container.querySelector('.leaflet-control-geosearch')).not.toBeNull();
      expect(baseLayerNames()).toStrictEqual(['Satellite (Esri)', 'Street']);
    });

    it('invalidates the map size when the container resizes', async () => {
      await init();
      const invalidate = vi.spyOn(map(), 'invalidateSize');
      const observer = FakeResizeObserver.instances[0];

      expect(observer?.observe).toHaveBeenCalledWith(map().getContainer());
      observer?.trigger();

      expect(invalidate).toHaveBeenCalledWith();
    });

    it('renders existing cameras and fits the map to them', async () => {
      const a = cameraService.addCamera(40, -74.5);
      const b = cameraService.addCamera(40.001, -74.499);
      const fitBounds = vi.spyOn(L.Map.prototype, 'fitBounds');

      await init();

      expect(internals(component).cameraLayers.size).toBe(2);
      expect(map().hasLayer(layersFor(a.id).marker)).toBe(true);
      expect(map().hasLayer(layersFor(b.id).fov)).toBe(true);
      expect(fitBounds).toHaveBeenCalledTimes(1);
      const [bounds, options] = fitBounds.mock.calls[0] ?? [];
      expect(bounds).toBeInstanceOf(L.LatLngBounds);
      expect((bounds as L.LatLngBounds).contains([40.0005, -74.4995])).toBe(true);
      expect((bounds as L.LatLngBounds).contains([40.01, -74.5])).toBe(false);
      expect(options).toStrictEqual({ padding: [50, 50], maxZoom: 19 });
    });

    it('does not fit bounds when there are no cameras', async () => {
      const fitBounds = vi.spyOn(L.Map.prototype, 'fitBounds');

      await init();

      expect(fitBounds).not.toHaveBeenCalled();
    });

    it('restores buildings when they were previously enabled', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      buildingService.setEnabled(true);
      fetchBuildings.mockResolvedValue([buildingNorthOf(camera, 20)]);

      await init();

      expect(fetchBuildings).toHaveBeenCalledWith(cameraService.cameras());
      expect(map().hasLayer(internals(component).buildingLayer)).toBe(true);
      expect(buildingPolygons()).toHaveLength(1);
    });
  });

  describe('camera sync', () => {
    it('adds markers and FOV polygons for new cameras', async () => {
      await init();

      const camera = cameraService.addCamera(40, -74.5);
      await settle();

      const { marker, fov } = layersFor(camera.id);
      expect(marker.getLatLng()).toMatchObject({ lat: 40, lng: -74.5 });
      expect(marker.options.draggable).toBe(true);
      // Leaflet drops the closing point that duplicates the first one
      expect(latLngsOf(fov)).toHaveLength(computeSimpleFov(camera).length - 1);
    });

    it('updates the marker, icon and FOV when a camera changes', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const { marker, fov } = layersFor(camera.id);
      const before = latLngsOf(fov)[1];

      cameraService.updateCamera(camera.id, { lat: 40.001, heading: 90 });
      await settle();

      expect(layersFor(camera.id).marker).toBe(marker);
      expect(marker.getLatLng().lat).toBeCloseTo(40.001, 9);
      expect((marker.options.icon as L.DivIcon).options.html).toContain('rotate(90deg)');
      expect(latLngsOf(fov)[1]).not.toStrictEqual(before);
    });

    it('removes layers for deleted cameras', async () => {
      const a = cameraService.addCamera(40, -74.5);
      const b = cameraService.addCamera(40.001, -74.5);
      await init();
      const { marker, fov } = layersFor(a.id);

      cameraService.deleteCamera(a.id);
      await settle();

      expect(internals(component).cameraLayers.has(a.id)).toBe(false);
      expect(internals(component).cameraLayers.has(b.id)).toBe(true);
      expect(map().hasLayer(marker)).toBe(false);
      expect(map().hasLayer(fov)).toBe(false);
    });

    it('styles the selected camera when it is created', async () => {
      await init();

      const camera = cameraService.addCamera(40, -74.5);
      await settle();

      const { marker, fov } = layersFor(camera.id);
      expect(fov.options.color).toBe(FOV_SELECTED_COLOR);
      expect((marker.options.icon as L.DivIcon).options.html).toContain('camera-marker selected');
    });

    it('styles unselected cameras with the default colour', async () => {
      cameraService.addCamera(40, -74.5);
      cameraService.selectCamera(null);
      const camera = cameraService.cameras()[0];
      await init();

      const { marker, fov } = layersFor(camera?.id ?? '');
      expect(fov.options.color).toBe(FOV_COLOR);
      expect(fov.options.weight).toBe(1);
      expect((marker.options.icon as L.DivIcon).options.html).not.toContain('selected');
    });
  });

  describe('selection', () => {
    it('highlights the selected camera and flies to it', async () => {
      const a = cameraService.addCamera(40, -74.5);
      const b = cameraService.addCamera(40.001, -74.499);
      await init();
      map().setZoom(15, { animate: false });

      cameraService.selectCamera(a.id);
      await settle();

      expect(layersFor(a.id).fov.options.color).toBe(FOV_SELECTED_COLOR);
      expect(layersFor(a.id).fov.options.fillOpacity).toBe(0.3);
      expect(layersFor(a.id).fov.options.weight).toBe(2);
      expect(layersFor(b.id).fov.options.color).toBe(FOV_COLOR);
      expect(layersFor(b.id).fov.options.fillOpacity).toBe(0.2);
      expect(map().flyTo).toHaveBeenLastCalledWith([40, -74.5], 18, { duration: 0.5 });
    });

    it('keeps a higher zoom level when flying to a camera', async () => {
      const a = cameraService.addCamera(40, -74.5);
      cameraService.addCamera(40.001, -74.499);
      await init();
      map().setZoom(20, { animate: false });

      cameraService.selectCamera(a.id);
      await settle();

      expect(map().flyTo).toHaveBeenLastCalledWith([40, -74.5], 20, { duration: 0.5 });
    });

    it('does not fly anywhere when the selection is cleared', async () => {
      cameraService.addCamera(40, -74.5);
      await init();

      cameraService.selectCamera(null);
      await settle();

      expect(map().flyTo).not.toHaveBeenCalled();
      for (const layers of internals(component).cameraLayers.values()) {
        expect(layers.fov.options.color).toBe(FOV_COLOR);
      }
    });

    it('ignores selection of an unknown camera', async () => {
      cameraService.addCamera(40, -74.5);
      await init();

      cameraService.selectCamera('missing');
      await settle();

      expect(map().flyTo).not.toHaveBeenCalled();
    });

    it('selects a camera when its marker is clicked', async () => {
      const a = cameraService.addCamera(40, -74.5);
      cameraService.addCamera(40.001, -74.499);
      await init();

      layersFor(a.id).marker.fire('click', { originalEvent: new MouseEvent('click') });

      expect(cameraService.selectedId()).toBe(a.id);
    });

    it('selects a camera when its FOV is clicked', async () => {
      const a = cameraService.addCamera(40, -74.5);
      cameraService.addCamera(40.001, -74.499);
      await init();

      layersFor(a.id).fov.fire('click', { originalEvent: new MouseEvent('click') });

      expect(cameraService.selectedId()).toBe(a.id);
    });
  });

  describe('dragging', () => {
    it('previews the FOV at the drag position using the simple FOV', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const { marker, fov } = layersFor(camera.id);

      marker.setLatLng([40.002, -74.5]);
      marker.fire('drag');

      const first = latLngsOf(fov)[0];
      expect(first?.lat).toBeCloseTo(40.002, 9);
      expect(latLngsOf(fov)).toHaveLength(computeSimpleFov(camera).length - 1);
      // The service is only updated on dragend
      expect(cameraService.cameras()[0]?.lat).toBe(40);
    });

    it('commits the new position on dragend', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const { marker } = layersFor(camera.id);

      marker.setLatLng([40.002, -74.501]);
      marker.fire('dragend', { distance: 10 });

      expect(cameraService.cameras()[0]).toMatchObject({ lat: 40.002, lng: -74.501 });
    });

    it('ignores drag events for a camera removed from the service', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const { marker, fov } = layersFor(camera.id);
      const before = latLngsOf(fov);

      // Delete without letting the sync effect run yet
      cameraService.deleteCamera(camera.id);
      marker.fire('drag');

      expect(latLngsOf(fov)).toStrictEqual(before);
    });

    it('ignores drag events once the camera layers are gone', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const { marker } = layersFor(camera.id);

      cameraService.deleteCamera(camera.id);
      await settle();

      expect(() => marker.fire('drag')).not.toThrow();
    });
  });

  describe('buildings', () => {
    it('loads and renders buildings when enabled, occluding the FOV', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      await init();
      const simpleLength = latLngsOf(layersFor(camera.id).fov).length;
      fetchBuildings.mockResolvedValue([buildingNorthOf(camera, 15)]);

      buildingService.setEnabled(true);
      await settle();

      expect(fetchBuildings).toHaveBeenCalledWith(cameraService.cameras());
      expect(map().hasLayer(internals(component).buildingLayer)).toBe(true);
      expect(buildingPolygons()).toHaveLength(1);
      expect(buildingPolygons()[0]?.options).toMatchObject({
        color: '#f97316',
        interactive: false,
      });
      // Visibility FOV uses more samples than the simple FOV
      expect(latLngsOf(layersFor(camera.id).fov).length).toBeGreaterThan(simpleLength);
    });

    it('does not add the building layer twice', async () => {
      cameraService.addCamera(40, -74.5);
      buildingService.setEnabled(true);
      await init();
      const addLayer = vi.spyOn(map(), 'addLayer');

      buildingService.setSearchRadius(300);
      await settle();

      expect(addLayer).not.toHaveBeenCalledWith(internals(component).buildingLayer);
      expect(fetchBuildings).toHaveBeenCalledTimes(2);
    });

    it('clears buildings and restores simple FOVs when disabled', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      fetchBuildings.mockResolvedValue([buildingNorthOf(camera, 15)]);
      buildingService.setEnabled(true);
      await init();
      expect(buildingPolygons()).toHaveLength(1);

      buildingService.setEnabled(false);
      await settle();

      expect(map().hasLayer(internals(component).buildingLayer)).toBe(false);
      expect(buildingPolygons()).toHaveLength(0);
      expect(internals(component).cachedBuildings).toStrictEqual([]);
      expect(latLngsOf(layersFor(camera.id).fov)).toHaveLength(computeSimpleFov(camera).length - 1);
    });

    it('clears buildings when the last camera is removed', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      fetchBuildings.mockResolvedValue([buildingNorthOf(camera, 15)]);
      buildingService.setEnabled(true);
      await init();
      fetchBuildings.mockClear();

      cameraService.deleteCamera(camera.id);
      await settle();

      expect(fetchBuildings).not.toHaveBeenCalled();
      expect(buildingPolygons()).toHaveLength(0);
      expect(internals(component).cachedBuildings).toStrictEqual([]);
    });

    it('reloads buildings when cameras change while enabled', async () => {
      cameraService.addCamera(40, -74.5);
      buildingService.setEnabled(true);
      await init();
      fetchBuildings.mockClear();

      cameraService.addCamera(40.001, -74.5);
      await settle();

      expect(fetchBuildings).toHaveBeenCalledTimes(1);
    });

    it('shifts building outlines by the configured offset', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      const building = buildingNorthOf(camera, 15);
      fetchBuildings.mockResolvedValue([building]);
      buildingService.setEnabled(true);
      await init();
      const original = latLngsOf(firstBuilding())[0];

      buildingService.setOffsetX(10);
      buildingService.setOffsetY(-5);
      await settle();

      const shifted = latLngsOf(firstBuilding())[0];
      const latShift = -5 / 111_320;
      const lngShift = 10 / (111_320 * Math.cos(((original?.lat ?? 0) * Math.PI) / 180));
      expect(shifted?.lat).toBeCloseTo((original?.lat ?? 0) + latShift, 9);
      expect(shifted?.lng).toBeCloseTo((original?.lng ?? 0) + lngShift, 9);
      // Fetch is not repeated for offset changes
      expect(fetchBuildings).toHaveBeenCalledTimes(1);
    });

    it('applies the offset to buildings used for visibility', async () => {
      const camera = cameraService.addCamera(40, -74.5);
      // Building straight ahead; shifting it 50 m east moves it out of a narrow FOV
      fetchBuildings.mockResolvedValue([buildingNorthOf(camera, 15)]);
      cameraService.updateCamera(camera.id, { fov: 10 });
      buildingService.setEnabled(true);
      await init();
      const occluded = latLngsOf(layersFor(camera.id).fov);
      const occludedNorth = occluded[Math.floor(occluded.length / 2)];

      buildingService.setOffsetX(50);
      await settle();

      const open = latLngsOf(layersFor(camera.id).fov);
      const openNorth = open[Math.floor(open.length / 2)];
      expect((openNorth?.lat ?? 0) - camera.lat).toBeGreaterThan(
        (occludedNorth?.lat ?? 0) - camera.lat,
      );
    });

    it('ignores offset changes while buildings are disabled', async () => {
      cameraService.addCamera(40, -74.5);
      await init();
      const render = vi.spyOn(internals(component), 'renderBuildings');

      buildingService.setOffsetX(5);
      await settle();

      expect(render).not.toHaveBeenCalled();
    });

    it('logs when loading buildings fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      cameraService.addCamera(40, -74.5);
      const error = new Error('boom');
      fetchBuildings.mockRejectedValue(error);

      buildingService.setEnabled(true);
      await init();

      expect(consoleError).toHaveBeenCalledWith('Failed to load buildings', error);
    });
  });

  describe('stale layer state', () => {
    it('skips the icon refresh for layers whose camera was just removed', async () => {
      const a = cameraService.addCamera(40, -74.5);
      const b = cameraService.addCamera(40.001, -74.5);
      await init();
      const staleMarker = layersFor(a.id).marker;
      const setIcon = vi.spyOn(staleMarker, 'setIcon');

      // Remove from the service without letting the sync effect run
      cameraService.deleteCamera(a.id);
      internals(component).highlightSelected(b.id);

      expect(setIcon).not.toHaveBeenCalled();
      expect(layersFor(a.id).fov.options.color).toBe(FOV_COLOR);
      expect(layersFor(b.id).fov.options.color).toBe(FOV_SELECTED_COLOR);
    });

    it('skips FOV recomputation for cameras not yet on the map', async () => {
      const a = cameraService.addCamera(40, -74.5);
      await init();
      const setLatLngs = vi.spyOn(layersFor(a.id).fov, 'setLatLngs');

      // Added to the service, but the sync effect has not run yet
      const pending = cameraService.addCamera(40.001, -74.5);
      internals(component).recomputeAllFovs();

      expect(setLatLngs).toHaveBeenCalledTimes(1);
      expect(internals(component).cameraLayers.has(pending.id)).toBe(false);
    });
  });

  describe('tile providers', () => {
    it('adds provider layers when API keys are configured', async () => {
      await init();

      settingsService.setGoogleApiKey('g-key');
      settingsService.setMapboxToken('m-token');
      settingsService.setBingApiKey('b-key');
      await settle();

      expect(baseLayerNames()).toStrictEqual([
        'Satellite (Esri)',
        'Street',
        'Google Satellite',
        'Mapbox Satellite',
        'Bing Aerial',
      ]);
      expect(map().getContainer().querySelectorAll('.leaflet-control-layers')).toHaveLength(1);
    });

    it('removes provider layers when keys are cleared', async () => {
      settingsService.setGoogleApiKey('g-key');
      await init();
      expect(baseLayerNames()).toContain('Google Satellite');

      settingsService.setGoogleApiKey('');
      await settle();

      expect(baseLayerNames()).toStrictEqual(['Satellite (Esri)', 'Street']);
    });
  });

  describe('destroy', () => {
    it('disconnects the resize observer and removes the map', async () => {
      await init();
      const remove = vi.spyOn(map(), 'remove');
      const observer = FakeResizeObserver.instances[0];

      fixture.destroy();

      expect(observer?.disconnect).toHaveBeenCalledWith();
      expect(remove).toHaveBeenCalledWith();
    });
  });
});

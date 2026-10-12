import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarComponent } from './sidebar';
import { BuildingService } from '../../services/building.service';
import { CameraService } from '../../services/camera.service';
import { SettingsService } from '../../services/settings.service';

import type { MapComponent } from '../map/map';

type FetchFn = typeof fetch;

function notFound(): Response {
  return { ok: false } as Partial<Response> as Response;
}

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let cameraService: CameraService;
  let buildingService: BuildingService;
  let settingsService: SettingsService;
  const fakeMap = {
    getCenter: vi.fn<MapComponent['getCenter']>(() => ({ lat: 12.5, lng: -3.25 })),
  };

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttonByText(text: string): HTMLButtonElement {
    const button = Array.from(root().querySelectorAll('button')).find(
      (b) => b.textContent.trim() === text,
    );
    if (!button) {
      throw new Error(`No button with text "${text}"`);
    }
    return button;
  }

  function cameraRows(): HTMLElement[] {
    return Array.from(root().querySelectorAll<HTMLElement>('[role="button"]'));
  }

  function rowAt(index: number): HTMLElement {
    const row = cameraRows()[index];
    if (!row) {
      throw new Error(`No camera row at index ${index}`);
    }
    return row;
  }

  function numberInputs(): HTMLInputElement[] {
    return Array.from(root().querySelectorAll<HTMLInputElement>('input[type="number"]'));
  }

  function textInputs(): HTMLInputElement[] {
    return Array.from(root().querySelectorAll<HTMLInputElement>('input[type="text"]'));
  }

  function change(input: HTMLInputElement | undefined, value: string): void {
    if (!input) {
      throw new Error('Input not found');
    }
    input.value = value;
    input.dispatchEvent(new Event('change'));
  }

  async function settle(): Promise<void> {
    TestBed.tick();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockResolvedValue(notFound()));
    await TestBed.configureTestingModule({ imports: [SidebarComponent] }).compileComponents();
    cameraService = TestBed.inject(CameraService);
    buildingService = TestBed.inject(BuildingService);
    settingsService = TestBed.inject(SettingsService);
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('mapRef', fakeMap);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('collapse', () => {
    it('hides and shows the panel contents', async () => {
      const toggle = root().querySelector('button');
      expect(root().querySelector('aside')?.classList).toContain('w-80');

      toggle?.click();
      await settle();

      expect(root().querySelector('aside')?.classList).toContain('w-12');
      expect(root().textContent).not.toContain('Cameras');

      toggle?.click();
      await settle();

      expect(root().textContent).toContain('Cameras');
    });
  });

  describe('camera list', () => {
    it('shows an empty state', () => {
      expect(root().textContent).toContain('No cameras yet.');
      expect(cameraRows()).toHaveLength(0);
    });

    it('adds a camera at the map center', async () => {
      buttonByText('+ Add').click();
      await settle();

      expect(fakeMap.getCenter).toHaveBeenCalledWith();
      expect(cameraService.cameras()).toHaveLength(1);
      expect(cameraService.cameras()[0]).toMatchObject({ lat: 12.5, lng: -3.25 });
      expect(cameraRows()).toHaveLength(1);
      expect(rowAt(0).textContent).toContain('Camera 1');
      expect(rowAt(0).textContent).toContain('FOV: 60');
      // New camera is selected, so the editor is shown
      expect(root().querySelector('cpm-camera-editor')).not.toBeNull();
      expect(rowAt(0).classList).toContain('bg-gray-700');
    });

    it('selects a camera when its row is clicked', async () => {
      const a = cameraService.addCamera(0, 0);
      cameraService.addCamera(1, 1);
      await settle();

      rowAt(0).click();
      await settle();

      expect(cameraService.selectedId()).toBe(a.id);
      expect(rowAt(0).classList).toContain('bg-gray-700');
      expect(rowAt(1).classList).not.toContain('bg-gray-700');
    });

    it.each(['Enter', ' '])('selects a camera with the "%s" key', async (key) => {
      const a = cameraService.addCamera(0, 0);
      cameraService.addCamera(1, 1);
      await settle();

      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      rowAt(0).dispatchEvent(event);

      expect(cameraService.selectedId()).toBe(a.id);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores other keys', async () => {
      cameraService.addCamera(0, 0);
      const b = cameraService.addCamera(1, 1);
      await settle();

      const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true });
      rowAt(0).dispatchEvent(event);

      expect(cameraService.selectedId()).toBe(b.id);
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores key events bubbling up from the Delete button', async () => {
      cameraService.addCamera(0, 0);
      const b = cameraService.addCamera(1, 1);
      await settle();

      const deleteButton = rowAt(0).querySelector('button');
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      deleteButton?.dispatchEvent(event);

      expect(cameraService.selectedId()).toBe(b.id);
      expect(event.defaultPrevented).toBe(false);
    });

    it('deletes a camera without selecting it', async () => {
      const a = cameraService.addCamera(0, 0);
      const b = cameraService.addCamera(1, 1);
      await settle();

      rowAt(0).querySelector('button')?.click();
      await settle();

      expect(cameraService.cameras().map((c) => c.id)).toStrictEqual([b.id]);
      expect(cameraService.selectedId()).toBe(b.id);
      expect(cameraService.selectedId()).not.toBe(a.id);
      expect(cameraRows()).toHaveLength(1);
    });
  });

  describe('buildings', () => {
    it('toggles buildings and shows the controls only when enabled', async () => {
      expect(buttonByText('OFF')).toBeDefined();
      expect(numberInputs()).toHaveLength(0);

      buttonByText('OFF').click();
      await settle();

      expect(buildingService.enabled()).toBe(true);
      expect(buttonByText('ON').className).toContain('bg-orange-600');
      expect(numberInputs()).toHaveLength(3);

      buttonByText('ON').click();
      await settle();

      expect(buildingService.enabled()).toBe(false);
    });

    it('updates search radius and offsets', async () => {
      buildingService.setEnabled(true);
      await settle();
      const [radius, offsetX, offsetY] = numberInputs();

      expect(radius?.value).toBe('150');

      change(radius, '300');
      change(offsetX, '-5');
      change(offsetY, '7');

      expect(buildingService.searchRadius()).toBe(300);
      expect(buildingService.offsetX()).toBe(-5);
      expect(buildingService.offsetY()).toBe(7);
    });

    it.each(['0', '-10', ''])('ignores a non-positive search radius of "%s"', async (value) => {
      buildingService.setEnabled(true);
      await settle();

      change(numberInputs()[0], value);

      expect(buildingService.searchRadius()).toBe(150);
    });
  });

  describe('settings', () => {
    async function openSettings(): Promise<void> {
      buttonByText('Settings').click();
      await settle();
    }

    it('toggles the settings panel', async () => {
      expect(textInputs()).toHaveLength(0);

      await openSettings();
      expect(textInputs()).toHaveLength(3);

      buttonByText('Settings').click();
      await settle();
      expect(textInputs()).toHaveLength(0);
    });

    it('updates each provider key', async () => {
      await openSettings();
      const [google, mapbox, bing] = textInputs();

      change(google, ' g-key ');
      change(mapbox, 'm-token');
      change(bing, 'b-key');

      expect(settingsService.googleApiKey()).toBe('g-key');
      expect(settingsService.mapboxToken()).toBe('m-token');
      expect(settingsService.bingApiKey()).toBe('b-key');
    });

    it('shows placeholders for missing keys', async () => {
      await openSettings();
      const [google, mapbox, bing] = textInputs();

      expect(google?.placeholder).toBe('Enter key...');
      expect(mapbox?.placeholder).toBe('Enter token...');
      expect(bing?.placeholder).toBe('Enter key...');
      expect(root().textContent).not.toContain('server');
    });
  });

  describe('export', () => {
    it('downloads the cameras as a dated JSON file', async () => {
      cameraService.addCamera(1, 2);
      await settle();
      const createObjectURL = vi.fn<typeof URL.createObjectURL>(() => 'blob:cameras');
      const revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>();
      // jsdom does not implement object URLs; stub a URL subclass for this test only
      vi.stubGlobal(
        'URL',
        class extends URL {
          static override createObjectURL = createObjectURL;
          static override revokeObjectURL = revokeObjectURL;
        },
      );
      const clicked: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicked.push(this);
      });

      buttonByText('Export').click();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]?.[0];
      if (!(blob instanceof Blob)) {
        throw new TypeError('Expected a Blob');
      }
      expect(blob.type).toBe('application/json');
      expect(JSON.parse(await blob.text())).toMatchObject({
        version: 1,
        cameras: cameraService.cameras(),
      });
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.href).toBe('blob:cameras');
      expect(clicked[0]?.download).toMatch(/^cameras-\d{4}-\d{2}-\d{2}\.json$/u);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cameras');
    });
  });

  describe('import', () => {
    function fileInput(): HTMLInputElement {
      const input = root().querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) {
        throw new Error('File input not found');
      }
      return input;
    }

    function selectFile(input: HTMLInputElement, files: File[]): void {
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change'));
    }

    it('imports cameras from the selected file', async () => {
      const importSpy = vi.spyOn(cameraService, 'importFromJson');
      const json = JSON.stringify([
        { id: 'x', name: 'X', lat: 1, lng: 2, heading: 3, fov: 4, range: 5 },
      ]);

      selectFile(fileInput(), [new File([json], 'cams.json', { type: 'application/json' })]);

      await vi.waitFor(() => {
        expect(importSpy).toHaveBeenCalledWith(json);
      });
      expect(cameraService.cameras().map((c) => c.id)).toStrictEqual(['x']);
      await settle();
      expect(cameraRows()).toHaveLength(1);
    });

    it('alerts when the import fails', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

      selectFile(fileInput(), [new File(['not json'], 'bad.json')]);

      await vi.waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Import failed: Invalid JSON');
      });
    });

    it('alerts with a generic message when no error is given', async () => {
      vi.spyOn(cameraService, 'importFromJson').mockReturnValue({ success: false, count: 0 });
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

      selectFile(fileInput(), [new File(['[]'], 'x.json')]);

      await vi.waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Import failed: unknown error');
      });
    });

    it('does nothing when no file is selected', () => {
      const importSpy = vi.spyOn(cameraService, 'importFromJson');

      selectFile(fileInput(), []);

      expect(importSpy).not.toHaveBeenCalled();
    });

    it('does nothing when the file list is unavailable', () => {
      const importSpy = vi.spyOn(cameraService, 'importFromJson');
      const input = fileInput();
      Object.defineProperty(input, 'files', { configurable: true, value: null });

      input.dispatchEvent(new Event('change'));

      expect(importSpy).not.toHaveBeenCalled();
    });
  });
});

describe('SidebarComponent with server-provided keys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('marks keys that come from the server config', async () => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchFn>().mockResolvedValue({
        ok: true,
        json: async () => Promise.resolve({ googleApiKey: 'g', mapboxToken: 'm', bingApiKey: 'b' }),
      } as Partial<Response> as Response),
    );
    await TestBed.configureTestingModule({ imports: [SidebarComponent] }).compileComponents();
    const settingsService = TestBed.inject(SettingsService);
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('mapRef', {});
    await vi.waitFor(() => {
      expect(settingsService.bingFromServer()).toBe(true);
    });
    const root = fixture.nativeElement as HTMLElement;
    Array.from(root.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === 'Settings')
      ?.click();
    await fixture.whenStable();

    const [google, mapbox, bing] = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    );
    expect(google?.placeholder).toBe('Using server key (override here)');
    expect(mapbox?.placeholder).toBe('Using server token (override here)');
    expect(bing?.placeholder).toBe('Using server key (override here)');
    expect(google?.value).toBe('g');
    expect(root.querySelectorAll('.text-green-500')).toHaveLength(3);
  });
});

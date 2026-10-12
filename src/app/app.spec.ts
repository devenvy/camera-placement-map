import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { CameraService } from './services/camera.service';

type FetchFn = typeof fetch;

class NoopResizeObserver {
  observe(): void {
    // No layout in jsdom
  }

  unobserve(): void {
    // No layout in jsdom
  }

  disconnect(): void {
    // No layout in jsdom
  }
}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockResolvedValue({ ok: false } as Response));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the sidebar and map, wiring the sidebar to the map center', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('app-sidebar')).not.toBeNull();
    expect(root.querySelector('app-map .leaflet-container')).not.toBeNull();

    const addButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === '+ Add',
    );
    addButton?.click();

    // New cameras are placed at the map's default center
    expect(TestBed.inject(CameraService).cameras()).toMatchObject([{ lat: 40, lng: -74.5 }]);
    fixture.destroy();
  });
});

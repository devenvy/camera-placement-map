import { computed, effect, Injectable, signal } from '@angular/core';

interface AppSettings {
  googleApiKey: string;
  mapboxToken: string;
  bingApiKey: string;
}

const SETTINGS_KEY = 'camera-placement-map-settings';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  // Server-provided defaults from config.json
  private readonly serverGoogleApiKey = signal('');
  private readonly serverMapboxToken = signal('');
  private readonly serverBingApiKey = signal('');

  // User overrides from localStorage / sidebar
  private readonly userGoogleApiKey = signal('');
  private readonly userMapboxToken = signal('');
  private readonly userBingApiKey = signal('');

  // Effective keys: user override wins, falls back to server default
  readonly googleApiKey = computed(() => this.userGoogleApiKey() || this.serverGoogleApiKey());
  readonly mapboxToken = computed(() => this.userMapboxToken() || this.serverMapboxToken());
  readonly bingApiKey = computed(() => this.userBingApiKey() || this.serverBingApiKey());

  // Whether each key came from the server (shown as hint in UI)
  readonly googleFromServer = computed(
    () => !this.userGoogleApiKey() && Boolean(this.serverGoogleApiKey()),
  );
  readonly mapboxFromServer = computed(
    () => !this.userMapboxToken() && Boolean(this.serverMapboxToken()),
  );
  readonly bingFromServer = computed(
    () => !this.userBingApiKey() && Boolean(this.serverBingApiKey()),
  );

  constructor() {
    this.loadSettings();
    this.loadServerConfig().catch((err: unknown) => {
      console.error('Failed to load server config', err);
    });
    effect(() => {
      const settings: AppSettings = {
        googleApiKey: this.userGoogleApiKey(),
        mapboxToken: this.userMapboxToken(),
        bingApiKey: this.userBingApiKey(),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
  }

  setGoogleApiKey(value: string): void {
    this.userGoogleApiKey.set(value.trim());
  }

  setMapboxToken(value: string): void {
    this.userMapboxToken.set(value.trim());
  }

  setBingApiKey(value: string): void {
    this.userBingApiKey.set(value.trim());
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
      const settings = parsed as Partial<Record<keyof AppSettings, unknown>>;
      if (typeof settings.googleApiKey === 'string') {
        this.userGoogleApiKey.set(settings.googleApiKey);
      }
      if (typeof settings.mapboxToken === 'string') {
        this.userMapboxToken.set(settings.mapboxToken);
      }
      if (typeof settings.bingApiKey === 'string') {
        this.userBingApiKey.set(settings.bingApiKey);
      }
    } catch {
      // Ignore corrupt settings
    }
  }

  private async loadServerConfig(): Promise<void> {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        return;
      }
      const parsed: unknown = await response.json();
      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }
      const config = parsed as Partial<Record<keyof AppSettings, unknown>>;
      if (typeof config.googleApiKey === 'string' && config.googleApiKey) {
        this.serverGoogleApiKey.set(config.googleApiKey);
      }
      if (typeof config.mapboxToken === 'string' && config.mapboxToken) {
        this.serverMapboxToken.set(config.mapboxToken);
      }
      if (typeof config.bingApiKey === 'string' && config.bingApiKey) {
        this.serverBingApiKey.set(config.bingApiKey);
      }
    } catch {
      // Config file not available, use user-provided keys only
    }
  }
}

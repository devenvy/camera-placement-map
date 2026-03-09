import { Injectable, signal, effect, computed } from '@angular/core';

interface AppSettings {
  googleApiKey: string;
  mapboxToken: string;
  bingApiKey: string;
}

const SETTINGS_KEY = 'camera-placement-map-settings';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  // Server-provided defaults from config.json
  private readonly _serverGoogleApiKey = signal('');
  private readonly _serverMapboxToken = signal('');
  private readonly _serverBingApiKey = signal('');

  // User overrides from localStorage / sidebar
  private readonly _userGoogleApiKey = signal('');
  private readonly _userMapboxToken = signal('');
  private readonly _userBingApiKey = signal('');

  // Effective keys: user override wins, falls back to server default
  readonly googleApiKey = computed(
    () => this._userGoogleApiKey() || this._serverGoogleApiKey(),
  );
  readonly mapboxToken = computed(
    () => this._userMapboxToken() || this._serverMapboxToken(),
  );
  readonly bingApiKey = computed(
    () => this._userBingApiKey() || this._serverBingApiKey(),
  );

  // Whether each key came from the server (shown as hint in UI)
  readonly googleFromServer = computed(
    () => !this._userGoogleApiKey() && !!this._serverGoogleApiKey(),
  );
  readonly mapboxFromServer = computed(
    () => !this._userMapboxToken() && !!this._serverMapboxToken(),
  );
  readonly bingFromServer = computed(
    () => !this._userBingApiKey() && !!this._serverBingApiKey(),
  );

  constructor() {
    this.loadSettings();
    this.loadServerConfig();
    effect(() => {
      const settings: AppSettings = {
        googleApiKey: this._userGoogleApiKey(),
        mapboxToken: this._userMapboxToken(),
        bingApiKey: this._userBingApiKey(),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
  }

  setGoogleApiKey(value: string): void {
    this._userGoogleApiKey.set(value.trim());
  }

  setMapboxToken(value: string): void {
    this._userMapboxToken.set(value.trim());
  }

  setBingApiKey(value: string): void {
    this._userBingApiKey.set(value.trim());
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const settings: AppSettings = JSON.parse(raw);
      if (typeof settings.googleApiKey === 'string') {
        this._userGoogleApiKey.set(settings.googleApiKey);
      }
      if (typeof settings.mapboxToken === 'string') {
        this._userMapboxToken.set(settings.mapboxToken);
      }
      if (typeof settings.bingApiKey === 'string') {
        this._userBingApiKey.set(settings.bingApiKey);
      }
    } catch {
      // Ignore corrupt settings
    }
  }

  private async loadServerConfig(): Promise<void> {
    try {
      const response = await fetch('config.json');
      if (!response.ok) return;
      const config: Partial<AppSettings> = await response.json();
      if (config.googleApiKey) {
        this._serverGoogleApiKey.set(config.googleApiKey);
      }
      if (config.mapboxToken) {
        this._serverMapboxToken.set(config.mapboxToken);
      }
      if (config.bingApiKey) {
        this._serverBingApiKey.set(config.bingApiKey);
      }
    } catch {
      // Config file not available, use user-provided keys only
    }
  }
}

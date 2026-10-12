import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsService } from './settings.service';

const SETTINGS_KEY = 'camera-placement-map-settings';

type FetchFn = typeof fetch;

function fakeResponse(init: Partial<Response>): Response {
  return init as Response;
}

function jsonResponse(body: unknown, ok = true): Response {
  return fakeResponse({ ok, json: async () => Promise.resolve(body) });
}

function invalidJsonResponse(): Response {
  return fakeResponse({ ok: true, json: async () => Promise.reject(new SyntaxError('bad json')) });
}

let fetchMock = vi.fn<FetchFn>();

/** Creates the service and waits for the async config.json load to settle. */
async function createService(): Promise<SettingsService> {
  const service = TestBed.inject(SettingsService);
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('config.json');
  });
  // Let the fetch/json promise chain resolve
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return service;
}

describe('SettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn<FetchFn>().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('requests config.json on startup', async () => {
    await createService();

    expect(fetchMock).toHaveBeenCalledWith('config.json');
  });

  it('has empty keys by default', async () => {
    const service = await createService();

    expect(service.googleApiKey()).toBe('');
    expect(service.mapboxToken()).toBe('');
    expect(service.bingApiKey()).toBe('');
    expect(service.googleFromServer()).toBe(false);
    expect(service.mapboxFromServer()).toBe(false);
    expect(service.bingFromServer()).toBe(false);
  });

  describe('server config', () => {
    it('uses server-provided keys when the user has none', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ googleApiKey: 'g-srv', mapboxToken: 'm-srv', bingApiKey: 'b-srv' }),
      );
      const service = await createService();

      expect(service.googleApiKey()).toBe('g-srv');
      expect(service.mapboxToken()).toBe('m-srv');
      expect(service.bingApiKey()).toBe('b-srv');
      expect(service.googleFromServer()).toBe(true);
      expect(service.mapboxFromServer()).toBe(true);
      expect(service.bingFromServer()).toBe(true);
    });

    it('ignores empty and non-string server values', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ googleApiKey: '', mapboxToken: 42, bingApiKey: null }),
      );
      const service = await createService();

      expect(service.googleApiKey()).toBe('');
      expect(service.mapboxToken()).toBe('');
      expect(service.bingApiKey()).toBe('');
      expect(service.googleFromServer()).toBe(false);
    });

    it.each([
      [
        'a non-OK response',
        async (): Promise<Response> => jsonResponse({ googleApiKey: 'x' }, false),
      ],
      ['a non-object body', async (): Promise<Response> => jsonResponse('nope')],
      ['a null body', async (): Promise<Response> => jsonResponse(null)],
      ['a network error', async (): Promise<Response> => Promise.reject(new Error('offline'))],
      ['invalid JSON', async (): Promise<Response> => invalidJsonResponse()],
    ])('falls back to user keys on %s', async (_label, impl) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fetchMock.mockImplementation(impl);
      const service = await createService();

      expect(service.googleApiKey()).toBe('');
      expect(service.googleFromServer()).toBe(false);
      // Errors are swallowed inside loadServerConfig
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('user overrides', () => {
    it('lets a user key win over the server key', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ googleApiKey: 'g-srv', mapboxToken: 'm-srv', bingApiKey: 'b-srv' }),
      );
      const service = await createService();

      service.setGoogleApiKey('g-user');
      service.setMapboxToken('m-user');
      service.setBingApiKey('b-user');

      expect(service.googleApiKey()).toBe('g-user');
      expect(service.mapboxToken()).toBe('m-user');
      expect(service.bingApiKey()).toBe('b-user');
      expect(service.googleFromServer()).toBe(false);
      expect(service.mapboxFromServer()).toBe(false);
      expect(service.bingFromServer()).toBe(false);
    });

    it('falls back to the server key when the override is cleared', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ googleApiKey: 'g-srv' }));
      const service = await createService();

      service.setGoogleApiKey('g-user');
      service.setGoogleApiKey('   ');

      expect(service.googleApiKey()).toBe('g-srv');
      expect(service.googleFromServer()).toBe(true);
    });

    it('trims whitespace from user input', async () => {
      const service = await createService();

      service.setGoogleApiKey('  g  ');
      service.setMapboxToken('\tm\n');
      service.setBingApiKey(' b ');

      expect(service.googleApiKey()).toBe('g');
      expect(service.mapboxToken()).toBe('m');
      expect(service.bingApiKey()).toBe('b');
    });

    it('persists only user overrides to localStorage', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ mapboxToken: 'm-srv' }));
      const service = await createService();

      service.setGoogleApiKey('g-user');
      TestBed.tick();

      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')).toStrictEqual({
        googleApiKey: 'g-user',
        mapboxToken: '',
        bingApiKey: '',
      });
    });

    it('restores user overrides from localStorage', async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ googleApiKey: 'g-saved', mapboxToken: 'm-saved', bingApiKey: 'b-saved' }),
      );
      fetchMock.mockResolvedValue(
        jsonResponse({ googleApiKey: 'g-srv', mapboxToken: 'm-srv', bingApiKey: 'b-srv' }),
      );
      const service = await createService();

      expect(service.googleApiKey()).toBe('g-saved');
      expect(service.mapboxToken()).toBe('m-saved');
      expect(service.bingApiKey()).toBe('b-saved');
      expect(service.googleFromServer()).toBe(false);
    });

    it('ignores non-string stored values', async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ googleApiKey: 1, mapboxToken: true, bingApiKey: {} }),
      );
      const service = await createService();

      expect(service.googleApiKey()).toBe('');
      expect(service.mapboxToken()).toBe('');
      expect(service.bingApiKey()).toBe('');
    });

    it.each([
      ['corrupt JSON', '{oops'],
      ['a JSON primitive', '"text"'],
      ['JSON null', 'null'],
    ])('ignores %s in storage', async (_label, raw) => {
      localStorage.setItem(SETTINGS_KEY, raw);
      const service = await createService();

      expect(service.googleApiKey()).toBe('');
    });
  });
});

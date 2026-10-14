import { describe, expect, it } from 'vitest';

import { BingTileLayer } from './bing-tile-layer';

import type * as L from 'leaflet';

/**
 * Leaflet sets the layer's tile zoom before requesting tile URLs and templates `{z}` (and so the
 * quadkey) from it; without a map in the test, set it the same way.
 */
function tileUrl(layer: BingTileLayer, coords: { x: number; y: number; z: number }): string {
  Object.assign(layer, { _tileZoom: coords.z });
  return layer.getTileUrl(coords as L.Coords);
}

describe('BingTileLayer', () => {
  it('configures attribution, subdomains and zoom limits', () => {
    const layer = new BingTileLayer('my-key');

    expect(layer.options.attribution).toBe('&copy; Microsoft');
    expect(layer.options.subdomains).toStrictEqual(['0', '1', '2', '3']);
    expect(layer.options.maxNativeZoom).toBe(19);
    expect(layer.options.maxZoom).toBe(22);
  });

  it.each([
    { x: 0, y: 0, z: 1, quadkey: '0' },
    { x: 1, y: 0, z: 1, quadkey: '1' },
    { x: 0, y: 1, z: 1, quadkey: '2' },
    { x: 1, y: 1, z: 1, quadkey: '3' },
    // Example from the Bing Maps tile system documentation
    { x: 3, y: 5, z: 3, quadkey: '213' },
    { x: 0, y: 0, z: 0, quadkey: '' },
  ])('builds quadkey "$quadkey" for tile ($x, $y) at zoom $z', ({ x, y, z, quadkey }) => {
    const url = tileUrl(new BingTileLayer('my-key'), { x, y, z });

    expect(url).toMatch(
      new RegExp(
        `^https://ecn\\.t[0-3]\\.tiles\\.virtualearth\\.net/tiles/a${quadkey}\\.jpeg`,
        'u',
      ),
    );
    expect(url).toContain('key=my-key');
    expect(url).not.toContain('{q}');
  });

  // regression: Leaflet used to throw "No value provided for variable {q}"
  it('resolves the quadkey placeholder with the default options', () => {
    expect(tileUrl(new BingTileLayer('my-key'), { x: 1, y: 1, z: 1 })).toContain('/tiles/a3.jpeg');
  });
});

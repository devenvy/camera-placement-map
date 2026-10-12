import * as L from 'leaflet';

// Weight of the y-axis bit in a quadkey digit (x contributes 1, y contributes 2)
const QUADKEY_Y_BIT_WEIGHT = 2;

function toQuadKey(x: number, y: number, z: number): string {
  let key = '';
  for (let i = z; i > 0; i--) {
    const bit = i - 1;
    // eslint-disable-next-line no-bitwise -- quadkeys interleave the bits of the x/y tile coordinates
    const digit = ((x >> bit) & 1) + ((y >> bit) & 1) * QUADKEY_Y_BIT_WEIGHT;
    key += digit;
  }
  return key;
}

/** Leaflet's typings omit URL-template variables, which are plain extra options. */
type BingTileLayerOptions = L.TileLayerOptions & { q: (tile: L.Coords) => string };

const BING_OPTIONS: BingTileLayerOptions = {
  attribution: '&copy; Microsoft',
  subdomains: ['0', '1', '2', '3'],
  maxNativeZoom: 19,
  maxZoom: 22,
  // Leaflet's URL template calls function-valued options with the tile's data
  q: (tile) => toQuadKey(tile.x, tile.y, tile.z),
};

// Bing Maps uses quadkey tile addressing instead of {z}/{x}/{y}
export class BingTileLayer extends L.TileLayer {
  constructor(apiKey: string) {
    super(
      `https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=14205&key=${apiKey}`,
      BING_OPTIONS,
    );
  }
}

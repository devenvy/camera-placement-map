# Camera Placement Map

A visual planning tool for security camera placement. Place cameras on a satellite map, configure their field of view, and identify coverage gaps before installation.

## Features

- **Interactive map** with satellite and street view layers (Esri / OpenStreetMap)
- **Multiple tile providers** — optionally add Google, Mapbox, or Bing satellite imagery via API keys in Settings
- **Draggable camera markers** with real-time FOV cone updates
- **Adjustable camera properties** — heading, field of view angle, and visual range
- **FOV occlusion** — building footprints from OpenStreetMap clip FOV cones so blocked areas are visible
- **Building offset** — nudge building outlines (E/W and N/S) to align with satellite imagery
- **Address search** — jump to any location using the built-in geocoder
- **Clone cameras** — duplicate a camera's settings and reposition the copy
- **Import / Export** — save and load camera layouts as JSON files
- **Auto-save** — camera layouts and settings persist in localStorage across sessions

## Getting Started

```bash
pnpm install
pnpm start
```

Open `http://localhost:4200/`. Click **+ Add** to place a camera at the center of the map, then drag it into position and adjust its properties in the sidebar.

## Docker

```bash
docker build -t camera-placement-map .
docker run -p 8080:80 camera-placement-map
```

Pass tile provider API keys as environment variables so all users get them automatically:

```bash
docker run -p 8080:80 \
  -e GOOGLE_API_KEY=your-key \
  -e MAPBOX_TOKEN=your-token \
  -e BING_API_KEY=your-key \
  camera-placement-map
```

Open `http://localhost:8080/`.

## Building

```bash
pnpm run build
```

Build output goes to `dist/`.

## CI and releases

- **CI** (`ci.yml`), on every pull request and weekly: lint (including `code-guidelines check`,
  knip, actionlint and zizmor), unit tests with coverage, the production build, a runtime dependency
  audit, dependency review, and a container build with a smoke test. `result` is the single
  required check. CodeQL and Code Quality also run on pull requests.
- **Every push to `main`** (`release.yml`): CI, then the site deploys to GitHub Pages and the image
  is pushed to `ghcr.io/devenvy/camera-placement-map` as `latest` and `sha-<commit>`.
- **Releases** are cut by hand: `gh release create vX.Y.Z --target main --generate-notes` (or the
  Releases page). Publishing one runs CI, pushes the image as `X.Y.Z` and `X.Y`, and attaches a zip of
  the static build and an SBOM to the release.

## Tile Providers

Esri satellite and OpenStreetMap street tiles are available by default. Additional providers appear in the layer control when an API key is configured.

| Provider         | Key required        | How to get one                                            |
| ---------------- | ------------------- | --------------------------------------------------------- |
| Google Satellite | Google Maps API key | [Google Cloud Console](https://console.cloud.google.com/) |
| Mapbox Satellite | Mapbox access token | [Mapbox account](https://account.mapbox.com/)             |
| Bing Aerial      | Bing Maps key       | [Bing Maps Dev Center](https://www.bingmapsportal.com/)   |

Keys can be provided in three ways (highest priority first):

1. **Per-user** — enter in the Settings section of the sidebar (stored in browser localStorage)
2. **Server-wide** — set Docker env vars or GitHub Actions secrets (`GOOGLE_API_KEY`, `MAPBOX_TOKEN`, `BING_API_KEY`)
3. **Static config** — edit `public/config.json` before building

## Data Sources

| Source                                                                                          | Used for                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite tiles (default)             |
| [OpenStreetMap](https://www.openstreetmap.org/)                                                 | Street tiles                          |
| [Nominatim](https://nominatim.openstreetmap.org/)                                               | Address search (geocoding)            |
| [Overpass API](https://overpass-api.de/)                                                        | Building footprints for FOV occlusion |

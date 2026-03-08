# Camera Placement Map

A visual planning tool for security camera placement. Place cameras on a satellite map, configure their field of view, and identify coverage gaps before installation.

## Features

- **Interactive map** with satellite and street view layers (Esri / OpenStreetMap)
- **Draggable camera markers** with real-time FOV cone updates
- **Adjustable camera properties** — heading, field of view angle, and visual range
- **FOV occlusion** — building footprints from OpenStreetMap clip FOV cones so blocked areas are visible
- **Address search** — jump to any location using the built-in geocoder
- **Clone cameras** — duplicate a camera's settings and reposition the copy
- **Import / Export** — save and load camera layouts as JSON files
- **Auto-save** — camera layouts and settings persist in localStorage across sessions

## Getting Started

```bash
npm install
ng serve
```

Open `http://localhost:4200/`. Click **+ Add** to place a camera at the center of the map, then drag it into position and adjust its properties in the sidebar.

## Docker

```bash
docker build -t camera-placement-map .
docker run -p 8080:80 camera-placement-map
```

Open `http://localhost:8080/`.

## Building

```bash
ng build
```

Build output goes to `dist/`.

## Data Sources

| Source | Used for |
|---|---|
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite tiles |
| [OpenStreetMap](https://www.openstreetmap.org/) | Street tiles |
| [Nominatim](https://nominatim.openstreetmap.org/) | Address search (geocoding) |
| [Overpass API](https://overpass-api.de/) | Building footprints for FOV occlusion |

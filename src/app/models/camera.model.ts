export interface Camera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  heading: number;
  fov: number;
  range: number;
}

export function createCamera(
  lat: number,
  lng: number,
  index: number,
): Camera {
  return {
    id: crypto.randomUUID(),
    name: `Camera ${index}`,
    lat,
    lng,
    heading: 0,
    fov: 60,
    range: 50,
  };
}

export interface CameraExport {
  version: 1;
  cameras: Camera[];
  exportedAt: string;
}

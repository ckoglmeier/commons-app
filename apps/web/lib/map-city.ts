export type MapCity = { id: string; label: string; latitude: number; longitude: number };

/** Keep the reported city at the center; zoom out only as far as the pins need.
 * Web Mercator pixels at zoom zero match the basemap's projection. */
export function cityMapZoom(city: Pick<MapCity, "latitude" | "longitude">, points: { latitude: number; longitude: number }[], size: { x: number; y: number }) {
  const y = (lat: number) => {
    const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) * 128;
  };
  let dx = 0, dy = 0;
  for (const p of points) {
    const delta = ((p.longitude - city.longitude + 540) % 360 + 360) % 360 - 180;
    dx = Math.max(dx, Math.abs(delta) * 256 / 360);
    dy = Math.max(dy, Math.abs(y(p.latitude) - y(city.latitude)));
  }
  const scale = Math.min(dx ? Math.max(1, size.x - 88) / (2 * dx) : Infinity, dy ? Math.max(1, size.y - 88) / (2 * dy) : Infinity);
  return Math.max(-2, Math.min(12, Math.floor(Math.log2(scale))));
}

export function cityRelativeLongitude(longitude: number, cityLongitude: number) {
  return cityLongitude + ((longitude - cityLongitude + 540) % 360 + 360) % 360 - 180;
}

import assert from "node:assert/strict";
import test from "node:test";
import { cityMapZoom, cityRelativeLongitude } from "./map-city";

const city = { latitude: 38.29186, longitude: -122.45804 };
test("an empty map starts at city scale, while an outlying place expands the same centered view", () => {
  assert.equal(cityMapZoom(city, [], { x: 327, y: 422 }), 12);
  const near = [{ latitude: 38.32, longitude: -122.48 }], far = [...near, { latitude: 37.615, longitude: -122.39 }, { latitude: -38.29, longitude: 57.54 }];
  for (const width of [287, 327, 640]) {
    const size = { x: width, y: 422 }, zoom = cityMapZoom(city, far, size);
    assert.ok(zoom < cityMapZoom(city, near, size));
    const world = 256 * 2 ** zoom;
    const projectY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) * world / 2;
    for (const p of far) {
      assert.ok(Math.abs(cityRelativeLongitude(p.longitude, city.longitude) - city.longitude) / 360 * world <= (width - 88) / 2);
      assert.ok(Math.abs(projectY(p.latitude) - projectY(city.latitude)) <= (size.y - 88) / 2);
    }
  }
});
test("places across the dateline fit around the reported city without changing saved coordinates", () => {
  const center = { latitude: -17, longitude: 179.5 }, point = { latitude: -17, longitude: -179.5 };
  assert.equal(cityRelativeLongitude(point.longitude, center.longitude), 180.5);
  assert.ok(cityMapZoom(center, [point], { x: 327, y: 422 }) >= 7);
  assert.equal(point.longitude, -179.5);
});

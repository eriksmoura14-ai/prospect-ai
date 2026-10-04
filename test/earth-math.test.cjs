const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const earthMath = fs.readFile(path.join(__dirname, "..", "earth-math.js"), "utf8")
  .then(source => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`);
}

function rotate(vector, quaternion) {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx];
}

test("globe marker follows equirectangular longitude and north/south axes", async () => {
  const { geographicVector } = await earthMath;
  const places = [
    [0, 0, [1, 0, 0]], [0, 90, [0, 0, -1]],
    [0, -90, [0, 0, 1]], [90, 0, [0, 1, 0]],
    [-90, 0, [0, -1, 0]], [0, 180, [-1, 0, 0]]
  ];
  for (const [latitude, longitude, expected] of places) {
    geographicVector(latitude, longitude).forEach((value, index) => close(value, expected[index]));
  }
});

test("travel faces real destinations toward the viewer while keeping north above", async () => {
  const { geographicVector, geographicQuaternion } = await earthMath;
  const places = [
    [-18.9186, -48.2772], [40.7128, -74.0060], [35.6762, 139.6503],
    [-33.8688, 151.2093], [64.1466, -21.9426], [0, 179.9], [0, -179.9]
  ];
  for (const [latitude, longitude] of places) {
    const quaternion = geographicQuaternion(latitude, longitude);
    close(Math.hypot(...quaternion), 1);
    const front = rotate(geographicVector(latitude, longitude), quaternion);
    front.forEach((value, index) => close(value, [0, 0, 1][index]));
    const north = rotate([0, 1, 0], quaternion);
    assert.ok(north[1] > 0, "north stays above the destination");
  }
});

test("globe refuses missing, impossible and unsupported location targets", async () => {
  const { validLocation } = await earthMath;
  for (const detail of [null, {}, { latitude: null, longitude: null, stage: "city" },
    { latitude: "", longitude: 0, stage: "country" },
    { latitude: 91, longitude: 0, stage: "state" },
    { latitude: 10, longitude: 181, stage: "city" },
    { latitude: NaN, longitude: 0, stage: "city" },
    { latitude: 0, longitude: 0, stage: "address" }]) {
    assert.equal(validLocation(detail), null);
  }
  assert.deepEqual(validLocation({ latitude: 0, longitude: 0, stage: "country", label: "Gana" }),
    { latitude: 0, longitude: 0, stage: "country", label: "Gana" });
});

test("flight easing starts and ends at rest and clamps suspended tab timing", async () => {
  const { smoothJourney } = await earthMath;
  close(smoothJourney(0), 0);
  close(smoothJourney(1), 1);
  close(smoothJourney(0.5), 0.5);
  close(smoothJourney(-1), 0);
  close(smoothJourney(8), 1);
  assert.ok(smoothJourney(0.001) < 0.00001);
  assert.ok(1 - smoothJourney(0.999) < 0.00001);
});

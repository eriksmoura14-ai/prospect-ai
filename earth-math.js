const TO_RADIANS = Math.PI / 180;

export function geographicVector(latitude, longitude, radius = 1) {
  const lat = latitude * TO_RADIANS;
  const lon = longitude * TO_RADIANS;
  const horizontal = Math.cos(lat) * radius;
  // SphereGeometry puts the Greenwich meridian at +X and east at -Z.
  return [horizontal * Math.cos(lon), Math.sin(lat) * radius,
    -horizontal * Math.sin(lon)];
}

export function geographicQuaternion(latitude, longitude) {
  const halfLatitude = latitude * TO_RADIANS / 2;
  const halfLongitude = (-90 - longitude) * TO_RADIANS / 2;
  const sx = Math.sin(halfLatitude);
  const cx = Math.cos(halfLatitude);
  const sy = Math.sin(halfLongitude);
  const cy = Math.cos(halfLongitude);
  // qX(latitude) · qY(-90 - longitude): selected point faces the camera,
  // with geographic north remaining above it rather than rolling the globe.
  return [sx * cy, cx * sy, sx * sy, cx * cy];
}

export function smoothJourney(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

export function validLocation(detail) {
  if (!detail || typeof detail !== "object") return null;
  if (detail.latitude === null || detail.latitude === undefined ||
      detail.longitude === null || detail.longitude === undefined ||
      detail.latitude === "" || detail.longitude === "") return null;
  const latitude = Number(detail.latitude);
  const longitude = Number(detail.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  if (!["country", "state", "city"].includes(detail.stage)) return null;
  return { latitude, longitude, stage: detail.stage,
    label: typeof detail.label === "string" ? detail.label.slice(0, 160) : "" };
}

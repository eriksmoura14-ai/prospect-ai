"use strict";

// A small preview of the selected city's public map, not a business location.
// Only tiles intersecting the visible panel are requested. Native <img>
// caching honours the tile server's Cache-Control/Expires/ETag headers.
(() => {
  const host = document.getElementById("overview-map");
  const workspace = document.getElementById("workspace");
  if (!host || !workspace) return;

  const zoom = 12;
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const maxLatitude = 85.0511287798066;
  const tiles = new Map();
  let target = null;
  let visible = false;
  let frame = 0;
  let disposed = false;

  host.classList.add("location-map");
  const viewport = document.createElement("div");
  viewport.className = "location-map-viewport";
  const openLink = document.createElement("a");
  openLink.className = "location-map-open";
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.hidden = true;
  const layer = document.createElement("div");
  layer.className = "location-map-tiles";
  layer.setAttribute("aria-hidden", "true");
  const marker = document.createElement("span");
  marker.className = "location-map-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.hidden = true;
  const label = document.createElement("span");
  label.className = "location-map-label";
  label.setAttribute("aria-hidden", "true");
  label.hidden = true;
  const status = document.createElement("p");
  status.className = "location-map-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const attribution = document.createElement("a");
  attribution.className = "location-map-attribution";
  attribution.href = "https://www.openstreetmap.org/copyright";
  attribution.target = "_blank";
  attribution.rel = "noopener noreferrer";
  attribution.textContent = "© OpenStreetMap contributors";
  attribution.hidden = true;
  openLink.append(layer, marker, label);
  viewport.append(openLink, status, attribution);
  host.replaceChildren(viewport);

  function point(detail, fromDiscovery = false) {
    if (!detail || typeof detail !== "object" ||
        (!fromDiscovery && detail.stage !== "city") ||
        !Number.isFinite(detail.latitude) || !Number.isFinite(detail.longitude) ||
        detail.latitude < -90 || detail.latitude > 90) return null;
    return {
      latitude: detail.latitude,
      longitude: ((detail.longitude + 180) % 360 + 360) % 360 - 180,
      label: String(detail.place || detail.label || "Cidade selecionada")
    };
  }

  function clearTiles() {
    for (const image of tiles.values()) {
      image.onload = null;
      image.onerror = null;
      image.remove();
    }
    tiles.clear();
  }

  function setTarget(next, emptyText = "Selecione uma cidade para ver o mapa.") {
    const unchanged = target && next && target.latitude === next.latitude &&
      target.longitude === next.longitude;
    target = workspace.hidden ? null : next;
    if (!unchanged || !target) clearTiles();
    marker.hidden = true;
    label.hidden = true;
    openLink.hidden = !target;
    attribution.hidden = !target;
    host.dataset.mapState = target ? "loading" : "empty";
    if (!target) {
      openLink.removeAttribute("href");
      openLink.removeAttribute("aria-label");
      delete host.dataset.latitude;
      delete host.dataset.longitude;
      delete host.dataset.mapSource;
      status.textContent = emptyText;
      status.hidden = false;
      return;
    }
    host.dataset.latitude = String(target.latitude);
    host.dataset.longitude = String(target.longitude);
    host.dataset.mapSource = "OpenStreetMap";
    const latitude = encodeURIComponent(target.latitude);
    const longitude = encodeURIComponent(target.longitude);
    openLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${zoom}/${latitude}/${longitude}`;
    openLink.setAttribute("aria-label", `Abrir mapa de ${target.label} no OpenStreetMap, em nova aba`);
    label.textContent = target.label;
    status.textContent = "Carregando mapa da cidade…";
    status.hidden = false;
    schedule();
  }

  function tileStatus() {
    if (!target || !tiles.size) return;
    const images = [...tiles.values()];
    const failed = images.some(image => image.dataset.state === "error");
    const complete = images.every(image => image.dataset.state === "ready");
    host.dataset.mapState = failed ? "error" : complete ? "ready" : "loading";
    marker.hidden = !complete;
    label.hidden = !complete;
    status.hidden = complete;
    status.textContent = failed
      ? "Mapa indisponível. Abra a localização no OpenStreetMap."
      : "Carregando mapa da cidade…";
  }

  function render() {
    frame = 0;
    if (disposed || !visible || !target || workspace.hidden || document.hidden) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    // This panel is bounded below 256 px in each axis: at most four tiles.
    const latitude = Math.max(-maxLatitude, Math.min(maxLatitude, target.latitude));
    const radians = latitude * Math.PI / 180;
    const x = (target.longitude + 180) / 360 * tileCount * tileSize;
    const y = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) /
      2 * tileCount * tileSize;
    const left = x - width / 2;
    const top = y - height / 2;
    const firstX = Math.floor(left / tileSize);
    const lastX = Math.floor((left + width - 0.01) / tileSize);
    const firstY = Math.floor(top / tileSize);
    const lastY = Math.floor((top + height - 0.01) / tileSize);
    const desired = new Set();
    for (let rawY = firstY; rawY <= lastY; rawY++) {
      if (rawY < 0 || rawY >= tileCount) continue;
      for (let rawX = firstX; rawX <= lastX; rawX++) {
        // Wrap at the antimeridian, without duplicating or losing a tile.
        const tileX = ((rawX % tileCount) + tileCount) % tileCount;
        const key = `${zoom}/${tileX}/${rawY}`;
        desired.add(key);
        let image = tiles.get(key);
        if (!image) {
          image = document.createElement("img");
          image.alt = "";
          image.width = tileSize;
          image.height = tileSize;
          image.decoding = "async";
          image.referrerPolicy = "strict-origin-when-cross-origin";
          image.dataset.state = "loading";
          image.onload = () => { image.dataset.state = "ready"; tileStatus(); };
          image.onerror = () => { image.dataset.state = "error"; tileStatus(); };
          tiles.set(key, image);
          layer.append(image);
          image.src = `https://tile.openstreetmap.org/${key}.png`;
        }
        image.style.left = `${rawX * tileSize - left}px`;
        image.style.top = `${rawY * tileSize - top}px`;
      }
    }
    for (const [key, image] of tiles) if (!desired.has(key)) {
      image.onload = null;
      image.onerror = null;
      image.remove();
      tiles.delete(key);
    }
    tileStatus();
  }

  function schedule() {
    if (disposed || frame || !visible || !target || document.hidden) return;
    frame = requestAnimationFrame(render);
  }
  function onLocation(event) { setTarget(point(event.detail)); }
  function onDiscovery(event) {
    if (event.detail && typeof event.detail === "object") {
      setTarget(point(event.detail, true), "Esta pesquisa não tem coordenadas disponíveis para o mapa.");
    } else setTarget(point(window.prospectLocationTarget));
  }
  function onSelection() { queueMicrotask(() => setTarget(point(window.prospectLocationTarget))); }
  function onSessionExpired() { setTarget(null); }
  function onVisibility() { if (!document.hidden) schedule(); }
  const viewportObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      schedule();
    }, { threshold: [0, 0.05] }) : null;
  if (viewportObserver) viewportObserver.observe(viewport);
  else visible = !host.closest("[hidden]");
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  resizeObserver?.observe(viewport);
  const workspaceObserver = new MutationObserver(() => {
    if (workspace.hidden) setTarget(null);
    else schedule();
  });
  workspaceObserver.observe(workspace, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("prospect:location", onLocation);
  window.addEventListener("prospect:discovery", onDiscovery);
  window.addEventListener("prospect:session-expired", onSessionExpired);
  document.addEventListener("visibilitychange", onVisibility);
  const selectionControls = ["country", "region", "city", "manual-country", "manual-region", "manual-city"]
    .map(id => document.getElementById(id)).filter(Boolean);
  for (const control of selectionControls) {
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", onSelection);
  }
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    disposed = true;
    cancelAnimationFrame(frame);
    viewportObserver?.disconnect();
    resizeObserver?.disconnect();
    workspaceObserver.disconnect();
    clearTiles();
    window.removeEventListener("prospect:location", onLocation);
    window.removeEventListener("prospect:discovery", onDiscovery);
    window.removeEventListener("prospect:session-expired", onSessionExpired);
    document.removeEventListener("visibilitychange", onVisibility);
    for (const control of selectionControls) {
      control.removeEventListener(control.tagName === "SELECT" ? "change" : "input", onSelection);
    }
  });
  setTarget(point(window.prospectLocationTarget));
})();

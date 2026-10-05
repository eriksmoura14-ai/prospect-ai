"use strict";

// Let the form paint before downloading and compiling the decorative 3D scene.
// The complete scene, textures and selected location remain the same.
(() => {
  const host = document.getElementById("earth-scene");
  if (!host) return;
  let started = false;
  function start() {
    if (started || document.hidden) return;
    started = true;
    document.removeEventListener("visibilitychange", resume);
    import("/earth-background.js").catch(() => host.classList.add("earth-fallback"));
  }
  function resume() { if (!document.hidden) schedule(); }
  function schedule() {
    if (started || document.hidden) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 1200 });
      else setTimeout(start, 0);
    }));
  }
  document.addEventListener("visibilitychange", resume);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
  else schedule();
})();

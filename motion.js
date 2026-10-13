"use strict";

(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let preference = null;
  try { const saved = localStorage.getItem("prospect-motion-paused"); if (saved !== null) preference = saved === "true"; } catch { /* Optional preference. */ }
  let paused = reduced.matches || preference === true;
  const scene = document.createElement("div");
  scene.className = "motion-scene";
  scene.setAttribute("aria-hidden", "true");
  // Fixed trusted SVG artwork; no external assets or user content.
  scene.innerHTML = '<div class="motion-wave"><svg viewBox="0 0 1440 900" preserveAspectRatio="none"><defs><linearGradient id="motion-ribbon-gradient"><stop stop-color="#7833cc" stop-opacity=".25"/><stop offset=".4" stop-color="#d496ff"/><stop offset=".7" stop-color="#ab6eff"/><stop offset="1" stop-color="#7365d8" stop-opacity=".2"/></linearGradient></defs><path class="wave-fill" d="M-120 610C130 270 410 820 740 470S1170 210 1560 520V1100H-120Z"/><path class="wave-glow" d="M-120 610C130 270 410 820 740 470S1170 210 1560 520"/><path class="wave-line" d="M-120 610C130 270 410 820 740 470S1170 210 1560 520"/><path class="wave-thread" d="M-100 550C190 300 390 750 730 400S1120 240 1540 460"/><path class="wave-thread" d="M-110 680C140 340 490 910 830 510S1200 300 1580 620"/></svg></div><div class="motion-wave motion-wave--second"><svg viewBox="0 0 1440 900" preserveAspectRatio="none"><path class="wave-fill" d="M-120 610C130 270 410 820 740 470S1170 210 1560 520V1100H-120Z"/><path class="wave-line" d="M-120 610C130 270 410 820 740 470S1170 210 1560 520"/><path class="wave-thread" d="M-100 550C190 300 390 750 730 400S1120 240 1540 460"/></svg></div>';
  const canvas = document.createElement("canvas");
  canvas.className = "motion-network";
  scene.append(canvas);
  document.body.prepend(scene);
  const ctx = canvas.getContext("2d");
  let width = 0, height = 0, nodes = [], trails = [], frame = 0, last = 0, time = 0, painted = 0;
  const pointer = { x: 0, y: 0, active: false, expires: 0 };
  const checkbox = document.getElementById("pause");
  const toggle = document.getElementById("motion-toggle");

  function resize() {
    width = window.innerWidth; height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    const count = Math.min(74, Math.max(28, Math.round(width * height / 19000)));
    nodes = Array.from({ length: count }, () => ({ x: Math.random() * width, y: Math.random() * height,
      vx: (Math.random() - .5) * .75, vy: (Math.random() - .5) * .75, dx: 0, dy: 0, radius: 1.1 + Math.random() * 1.1 }));
    scene.dataset.nodeCount = String(count);
    scene.dataset.pixelRatio = String(scale);
    if (ctx) paint(0);
  }

  function paint(delta) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const brightness = document.body.classList.contains("motion-bright") ? 1.35 : 1;
    const distance = width < 600 ? 145 : 175;
    for (const node of nodes) {
      if (pointer.active) {
        const x = node.x - pointer.x, y = node.y - pointer.y, length = Math.hypot(x, y);
        if (length > 1 && length < 135) { const force = (1 - length / 135) * .65; node.dx += x / length * force * delta; node.dy += y / length * force * delta; }
      }
      node.dx *= .94; node.dy *= .94;
      node.x += (node.vx + node.dx) * delta; node.y += (node.vy + node.dy) * delta;
      if (node.x < -10) node.x = width + 10; if (node.x > width + 10) node.x = -10;
      if (node.y < -10) node.y = height + 10; if (node.y > height + 10) node.y = -10;
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], length = Math.hypot(a.x - b.x, a.y - b.y);
        if (length > distance) continue;
        const alpha = (1 - length / distance) * .24 * brightness;
        ctx.strokeStyle = `rgba(184,132,244,${alpha})`; ctx.lineWidth = .75;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if ((i + j) % 9 === 0) {
          const progress = (time / 2400 + i * .17) % 1;
          ctx.fillStyle = `rgba(225,193,255,${alpha * 2.7})`;
          ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.fillStyle = `rgba(207,164,255,${(.35 + .24 * Math.sin(time / 1400 + i)) * brightness})`;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2); ctx.fill();
    }
    trails = trails.filter(trail => time - trail.time < 1000);
    for (const trail of trails) {
      const progress = Math.max(0, (time - trail.time) / 1000);
      ctx.strokeStyle = `rgba(215,161,255,${(1 - progress) * .42})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(trail.x, trail.y, 8 + progress * (trail.touch ? 135 : 45), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(196,115,255,${(1 - progress) * .18})`;
      ctx.beginPath(); ctx.arc(trail.x, trail.y, 3 + progress * 12, 0, Math.PI * 2); ctx.fill();
    }
  }

  function tick(stamp) {
    frame = 0;
    if (paused || document.hidden || !ctx) return;
    if (stamp - last >= 32) {
      const elapsed = Math.min(66, last ? stamp - last : 32); last = stamp; time += elapsed;
      if (pointer.expires && performance.now() > pointer.expires) pointer.active = false;
      paint(elapsed / 32);
      if (++painted % 20 === 0) scene.dataset.frame = String(painted);
    }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    document.body.classList.toggle("motion-paused", paused);
    document.body.classList.toggle("motion-suspended", document.hidden);
    scene.dataset.motionState = paused ? "paused" : document.hidden ? "suspended" : "running";
    if (checkbox) checkbox.checked = paused;
    if (toggle) {
      toggle.textContent = paused ? "▶" : "Ⅱ";
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.setAttribute("aria-label", paused ? "Retomar animações" : "Pausar animações");
      toggle.title = paused ? "Retomar animações" : "Pausar animações";
    }
    if (frame) cancelAnimationFrame(frame); frame = 0; last = 0;
    if (!paused && !document.hidden && ctx) frame = requestAnimationFrame(tick);
  }

  function choosePause(value) {
    paused = reduced.matches || value;
    preference = value;
    try { localStorage.setItem("prospect-motion-paused", String(value)); } catch { /* Optional preference. */ }
    sync();
  }
  toggle?.addEventListener("click", () => choosePause(!paused));
  checkbox?.addEventListener("change", () => choosePause(checkbox.checked));
  document.getElementById("bright")?.addEventListener("change", event => {
    document.body.classList.toggle("motion-bright", event.target.checked); if (paused && ctx) paint(0);
  });
  let reactions = 0;
  function react(event) {
    if (paused || document.hidden) return;
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true;
    pointer.expires = event.pointerType === "touch" ? performance.now() + 900 : 0;
    if (event.type === "pointerdown" || !trails.length || Math.hypot(pointer.x - trails.at(-1).x, pointer.y - trails.at(-1).y) > 18) {
      if (trails.length >= 24) trails.shift();
      trails.push({ x: pointer.x, y: pointer.y, time, touch: event.pointerType === "touch" || event.type === "pointerdown" });
      scene.dataset.reactionCount = String(++reactions);
    }
  }
  document.addEventListener("pointermove", react, { passive: true });
  document.addEventListener("pointerdown", react, { passive: true });
  document.addEventListener("pointerleave", () => { pointer.active = false; }, { passive: true });
  document.addEventListener("pointercancel", () => { pointer.active = false; }, { passive: true });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", resize);
  reduced.addEventListener("change", () => { paused = reduced.matches || preference === true; sync(); });
  window.addEventListener("prospect:agent-activity", event => { document.body.classList.toggle("agent-thinking", event.detail === true); });
  const simulate = document.getElementById("motion-demo-thinking");
  simulate?.addEventListener("click", () => {
    const active = !document.body.classList.contains("agent-thinking");
    window.dispatchEvent(new CustomEvent("prospect:agent-activity", { detail: active }));
    simulate.setAttribute("aria-pressed", String(active));
    simulate.textContent = active ? "Parar simulação" : "Simular resposta da IA";
  });
  resize(); sync();
})();

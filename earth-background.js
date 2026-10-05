import * as THREE from "/vendor/three.module.js";
import { geographicVector, geographicQuaternion, smoothJourney, validLocation }
  from "/earth-math.js";

const container = document.getElementById("earth-scene");

if (container) startEarth(container);

function startEarth(host) {
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionPreference.matches;
  let paused = false;
  let ready = false;
  let failed = false;
  let disposed = false;
  let currentTarget = null;
  let pendingFrame = 0;
  let previousFrame = 0;
  let needsPaint = true;
  let frameCount = 0;
  let journey = null;
  let renderer;
  let scene;
  let camera;
  let earth;
  let globePlacement;
  let marker;
  let planetMaterial;
  let clouds;
  let glow;
  const resources = new Set();
  const textureLoader = new THREE.TextureLoader();
  const earthRadius = 1.72;
  const textureProfile = window.innerWidth <= 640 ? "mobile" : "desktop";
  const textureStatus = Object.fromEntries(["day", "night", "clouds", "specular"]
    .map(name => [name, { loaded: false, width: 0, height: 0, path: "" }]));
  const starStatus = { layers: 0, count: 0, galacticCount: 0 };
  const defaultRotation = new THREE.Quaternion()
    .fromArray(geographicQuaternion(-12, -45));
  const targetScales = { country: 1, state: 1.08, city: 1.16 };
  const lightDirection = new THREE.Vector3(0.6, 2.8, 5.8).normalize();
  const motionButton = document.getElementById("earth-motion");
  const locationLabel = document.createElement("div");
  locationLabel.className = "earth-location";
  locationLabel.hidden = true;
  const locationKicker = document.createElement("span");
  locationKicker.className = "earth-location-kicker";
  const locationName = document.createElement("span");
  locationName.className = "earth-location-name";
  locationLabel.append(locationKicker, locationName);
  host.append(locationLabel);

  // Useful when verifying the real canvas and reduced-motion behavior; no
  // authentication, business data or provider configuration is exposed.
  Object.defineProperty(window, "prospectEarth", {
    configurable: true,
    value: Object.freeze({
      get ready() { return ready; },
      get currentTarget() { return currentTarget ? { ...currentTarget } : null; },
      get target() { return currentTarget ? { ...currentTarget } : null; },
      get paused() { return paused; },
      get reducedMotion() { return reducedMotion; },
      get frameCount() { return frameCount; },
      get zoom() { return earth?.scale.x ?? 1; },
      get isAnimating() {
        return ready && !failed && !paused && !reducedMotion && !document.hidden;
      },
      get graphics() {
        return {
          profile: textureProfile,
          fpsLimit: 30,
          textures: Object.fromEntries(Object.entries(textureStatus)
            .map(([name, status]) => [name, { ...status }])),
          texturesLoaded: Object.fromEntries(Object.entries(textureStatus)
            .map(([name, status]) => [name, status.loaded])),
          cloudRotation: clouds?.rotation.y ?? 0,
          stars: { ...starStatus },
          drawCalls: renderer?.info.render.calls ?? 0,
          triangles: renderer?.info.render.triangles ?? 0,
          gpuTextures: renderer?.info.memory.textures ?? 0
        };
      },
      get renderMode() {
        return failed ? "fallback" : reducedMotion ? "reduced-motion"
          : paused ? "paused" : "animated";
      }
    })
  });

  function keep(resource) {
    resources.add(resource);
    return resource;
  }

  function fallback() {
    failed = true;
    ready = false;
    stopFrames();
    host.classList.remove("webgl-ready");
    host.classList.add("earth-fallback");
    locationLabel.hidden = true;
    updateMotionButton();
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: window.innerWidth > 640,
      alpha: true,
      powerPreference: "low-power"
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.className = "earth-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.tabIndex = -1;
    host.prepend(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 8.6);
    earth = new THREE.Group();
    earth.quaternion.copy(defaultRotation);
    globePlacement = new THREE.Group();
    globePlacement.add(earth);
    scene.add(globePlacement);
    const segments = window.innerWidth <= 640 ? 64 : 96;
    const sphere = keep(new THREE.SphereGeometry(earthRadius, segments, segments));
    planetMaterial = keep(new THREE.MeshPhongMaterial({
      color: 0xffffff,
      specular: 0x395168,
      shininess: 100
    }));
    earth.add(new THREE.Mesh(sphere, planetMaterial));
    scene.add(new THREE.AmbientLight(0xb7cffc, 0.23));
    const sunlight = new THREE.DirectionalLight(0xfff8ef, 2.5);
    sunlight.position.copy(lightDirection).multiplyScalar(8);
    scene.add(sunlight);
    const reflectedLight = new THREE.DirectionalLight(0x3271af, 0.09);
    reflectedLight.position.set(4, -2, -4);
    scene.add(reflectedLight);
    addAtmosphere(segments);
    addStars();
    marker = createMarker();
    marker.visible = false;
    earth.add(marker);
    resize();
  } catch {
    fallback();
    disposeGraphics();
    return;
  }

  function addAtmosphere(segments) {
    const material = keep(new THREE.ShaderMaterial({
      uniforms: {
        sunlight: { value: lightDirection },
        dayColor: { value: new THREE.Color(0x86bdff) },
        nightColor: { value: new THREE.Color(0x234b8c) }
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vView;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vView = cameraPosition - worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 sunlight;
        uniform vec3 dayColor;
        uniform vec3 nightColor;
        varying vec3 vWorldNormal;
        varying vec3 vView;
        void main() {
          vec3 normal = normalize(vWorldNormal);
          float grazing = 1.0 - abs(dot(normal, normalize(vView)));
          float opticalDepth = pow(clamp(grazing, 0.0, 1.0), 3.6);
          float day = smoothstep(-0.25, 0.6, dot(normal, sunlight));
          vec3 scatteredLight = mix(nightColor, dayColor, day);
          gl_FragColor = vec4(scatteredLight, opticalDepth * (0.18 + day * 0.35));
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const shell = keep(new THREE.SphereGeometry(earthRadius * 1.018,
      segments, segments));
    earth.add(new THREE.Mesh(shell, material));
  }

  function softDotTexture(color) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, `rgba(${color}, 1)`);
    gradient.addColorStop(0.22, `rgba(${color}, .65)`);
    gradient.addColorStop(0.6, `rgba(${color}, .08)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return keep(new THREE.CanvasTexture(canvas));
  }

  function addStars() {
    const mobile = textureProfile === "mobile";
    let seed = 1746;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) *
      Math.cos(Math.PI * 2 * random());
    const pointTexture = softDotTexture("255, 255, 255");
    const temperatures = [new THREE.Color(0xcad9ff), new THREE.Color(0xeaf1ff),
      new THREE.Color(0xffefd7), new THREE.Color(0xffd4aa)];

    function starLayer(count, size, opacity, galactic = false) {
      const vertices = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) {
        const x = (random() - 0.5) * (galactic ? 58 : 45);
        vertices[index * 3] = x;
        vertices[index * 3 + 1] = galactic
          ? x * 0.29 + gaussian() * (random() < 0.7 ? 1.1 : 2.6)
          : (random() - 0.5) * 30;
        vertices[index * 3 + 2] = galactic ? -25 - random() * 8 : -14 - random() * 25;
        const color = temperatures[Math.floor(random() * temperatures.length)];
        const brightness = galactic ? 0.26 + random() * 0.32 : 0.52 + random() * 0.48;
        colors[index * 3] = color.r * brightness;
        colors[index * 3 + 1] = color.g * brightness;
        colors[index * 3 + 2] = color.b * brightness;
      }
      const geometry = keep(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const material = keep(new THREE.PointsMaterial({
        size, map: pointTexture, transparent: true, vertexColors: true,
        opacity, depthWrite: false, blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      }));
      scene.add(new THREE.Points(geometry, material));
      if (galactic) starStatus.galacticCount = count;
      else starStatus.count += count;
    }

    // Different apparent magnitudes and color temperatures create irregular,
    // pinpoint stars rather than an evenly spaced decorative dot grid.
    starLayer(mobile ? 650 : 1500, 0.039, 0.68);
    starLayer(mobile ? 90 : 220, 0.075, 0.82);
    starLayer(mobile ? 12 : 32, 0.125, 0.94);
    starStatus.layers = 3;
    // A restrained stellar band suggests the Milky Way. It is generated once,
    // with no full-screen noise shader, downloaded skybox, or animated nebula.
    starLayer(mobile ? 950 : 2400, 0.041, 0.42, true);
  }

  function addClouds(texture) {
    const mobile = textureProfile === "mobile";
    const geometry = keep(new THREE.SphereGeometry(earthRadius * 1.006,
      mobile ? 48 : 72, mobile ? 48 : 72));
    const material = keep(new THREE.MeshPhongMaterial({
      map: texture,
      transparent: true,
      opacity: 0.84,
      shininess: 4,
      specular: 0x111111,
      depthWrite: false
    }));
    clouds = new THREE.Mesh(geometry, material);
    earth.add(clouds);
  }

  function createMarker() {
    const group = new THREE.Group();
    const core = keep(new THREE.SphereGeometry(0.018, 12, 8));
    const green = keep(new THREE.MeshBasicMaterial({ color: 0xb8ff87 }));
    group.add(new THREE.Mesh(core, green));
    const innerRing = keep(new THREE.TorusGeometry(0.042, 0.0025, 8, 48));
    const outerRing = keep(new THREE.TorusGeometry(0.074, 0.0014, 8, 48));
    group.add(new THREE.Mesh(innerRing, green));
    const translucent = keep(new THREE.MeshBasicMaterial({
      color: 0xb8ff87, transparent: true, opacity: 0.48, depthWrite: false
    }));
    group.add(new THREE.Mesh(outerRing, translucent));
    const spriteMaterial = keep(new THREE.SpriteMaterial({
      map: softDotTexture("180, 255, 122"),
      color: 0xb8ff87,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow = new THREE.Sprite(spriteMaterial);
    glow.scale.setScalar(0.29);
    group.add(glow);
    return group;
  }

  function addNightLights(texture) {
    const material = keep(new THREE.ShaderMaterial({
      uniforms: {
        nightTexture: { value: texture },
        sunlight: { value: lightDirection }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D nightTexture;
        uniform vec3 sunlight;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vec3 lights = texture2D(nightTexture, vUv).rgb;
          float night = 1.0 - smoothstep(-0.20, 0.35,
            dot(normalize(vWorldNormal), sunlight));
          float brightness = max(max(lights.r, lights.g), lights.b);
          gl_FragColor = vec4(lights * 1.8, night * brightness * 0.95);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const geometry = keep(new THREE.SphereGeometry(earthRadius * 1.001,
      window.innerWidth <= 640 ? 64 : 96, 64));
    earth.add(new THREE.Mesh(geometry, material));
  }

  function resize() {
    if (disposed || failed) return;
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    if (!width || !height) return;
    const mobile = width <= 640;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
      mobile ? 1.25 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = mobile ? 8.5 : 8.6;
    camera.updateProjectionMatrix();
    const visibleWidth = 2 * camera.position.z *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const visibleHeight = visibleWidth / camera.aspect;
    const maximumRadiusFraction = earthRadius * targetScales.city * 1.08 / visibleWidth;
    const desktopCenter = Math.min(0.76, 0.98 - maximumRadiusFraction);
    globePlacement.position.set(visibleWidth * (mobile ? 0.23 : desktopCenter - 0.5),
      visibleHeight * (mobile ? 0.28 : 0.10), 0);
    // The globe is deliberately off center. Align its front with the camera's
    // actual sightline, otherwise perspective pushes the chosen pin to its rim.
    globePlacement.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
      camera.position, globePlacement.position, new THREE.Vector3(0, 1, 0)));
    requestFrame();
  }

  function requestFrame(forcePaint = true) {
    if (forcePaint) needsPaint = true;
    if (disposed || failed || document.hidden || pendingFrame) return;
    pendingFrame = requestAnimationFrame(renderFrame);
  }

  function stopFrames() {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    previousFrame = 0;
  }

  function renderFrame(now) {
    pendingFrame = 0;
    if (disposed || failed || document.hidden) return;
    if (!reducedMotion && !paused && !needsPaint && previousFrame &&
        now - previousFrame < 1000 / 30 - 0.5) {
      requestFrame(false);
      return;
    }
    needsPaint = false;
    const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.05) : 0;
    previousFrame = now;
    if (journey) {
      const progress = reducedMotion || paused ? 1
        : (now - journey.startedAt) / journey.duration;
      const ease = smoothJourney(progress);
      earth.quaternion.slerpQuaternions(journey.from, journey.to, ease);
      earth.scale.setScalar(THREE.MathUtils.lerp(journey.fromScale,
        journey.toScale, ease));
      if (progress >= 1) journey = null;
    } else if (!reducedMotion && !paused && !currentTarget) {
      earth.rotateY(delta * 0.025);
    }
    if (glow && !reducedMotion && !paused) {
      glow.material.opacity = 0.57 + Math.sin(now * 0.0018) * 0.08;
    }
    if (clouds && !reducedMotion && !paused) clouds.rotation.y += delta * 0.0035;
    try {
      renderer.render(scene, camera);
      frameCount++;
      if (planetMaterial.map && !ready) {
        ready = true;
        host.classList.add("webgl-ready");
        host.classList.remove("earth-fallback");
        showLocation();
        updateMotionButton();
      }
      positionLocationLabel();
    } catch {
      fallback();
      return;
    }
    if (!reducedMotion && !paused && ready) requestFrame(false);
  }

  function showLocation() {
    locationLabel.hidden = !ready || !currentTarget || !currentTarget.label;
    if (locationLabel.hidden) return;
    locationKicker.textContent = {
      country: "PAÍS SELECIONADO",
      state: "REGIÃO SELECIONADA",
      city: "DESTINO SELECIONADO"
    }[currentTarget.stage];
    locationName.textContent = currentTarget.label;
  }

  const labelPoint = new THREE.Vector3();
  const earthCenter = new THREE.Vector3();
  const labelNormal = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();

  function positionLocationLabel() {
    if (!ready || !currentTarget?.label || !marker.visible) {
      locationLabel.hidden = true;
      return;
    }
    marker.getWorldPosition(labelPoint);
    earth.getWorldPosition(earthCenter);
    labelNormal.copy(labelPoint).sub(earthCenter).normalize();
    viewDirection.copy(camera.position).sub(labelPoint).normalize();
    const facesViewer = labelNormal.dot(viewDirection) > 0.05;
    labelPoint.project(camera);
    if (!facesViewer || labelPoint.z > 1 || Math.abs(labelPoint.x) > 1.05 ||
        Math.abs(labelPoint.y) > 1.05) {
      locationLabel.hidden = true;
      return;
    }
    locationLabel.hidden = false;
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    const pointX = (labelPoint.x + 1) * width / 2;
    const pointY = (1 - labelPoint.y) * height / 2;
    const labelWidth = locationLabel.offsetWidth || Math.min(240, width - 24);
    const labelHeight = locationLabel.offsetHeight || 48;
    const preferredX = pointX + labelWidth + 32 < width
      ? pointX + 18 : pointX - labelWidth - 18;
    locationLabel.style.left = `${Math.max(12,
      Math.min(width - labelWidth - 12, preferredX))}px`;
    locationLabel.style.top = `${Math.max(12,
      Math.min(height - labelHeight - 12, pointY - labelHeight / 2))}px`;
  }

  function moveTo(detail) {
    const nextTarget = validLocation(detail);
    // An unavailable/manual place must not leave a marker on the previous
    // city and suggest that it is the newly chosen location.
    currentTarget = nextTarget;
    marker.visible = Boolean(nextTarget);
    if (nextTarget) {
      const position = new THREE.Vector3()
        .fromArray(geographicVector(nextTarget.latitude, nextTarget.longitude,
          earthRadius * 1.023));
      marker.position.copy(position);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
        position.clone().normalize());
    }
    const orientation = nextTarget
      ? new THREE.Quaternion().fromArray(geographicQuaternion(
        nextTarget.latitude, nextTarget.longitude))
      : defaultRotation.clone();
    const scale = nextTarget ? targetScales[nextTarget.stage] : 1;
    if (reducedMotion || paused) {
      earth.quaternion.copy(orientation);
      earth.scale.setScalar(scale);
      journey = null;
    } else {
      journey = {
        from: earth.quaternion.clone(), to: orientation,
        fromScale: earth.scale.x, toScale: scale,
        startedAt: performance.now(), duration: nextTarget?.stage === "city" ? 1650 : 1950
      };
    }
    showLocation();
    requestFrame();
  }

  function onLocation(event) {
    if (disposed || failed) return;
    moveTo(event.detail);
  }

  function onVisibility() {
    if (document.hidden) stopFrames();
    else requestFrame();
  }

  function onMotionPreference(event) {
    reducedMotion = event.matches;
    if (reducedMotion && journey) {
      earth.quaternion.copy(journey.to);
      earth.scale.setScalar(journey.toScale);
      journey = null;
    }
    stopFrames();
    updateMotionButton();
    requestFrame();
  }

  function updateMotionButton() {
    if (!motionButton) return;
    motionButton.hidden = !ready || failed || reducedMotion;
    const label = paused ? "Retomar animação" : "Pausar animação";
    motionButton.textContent = label;
    motionButton.setAttribute("aria-label", label);
    motionButton.setAttribute("aria-pressed", String(paused));
  }

  function onPause() {
    paused = !paused;
    if (paused && journey) {
      earth.quaternion.copy(journey.to);
      earth.scale.setScalar(journey.toScale);
      journey = null;
    }
    stopFrames();
    updateMotionButton();
    requestFrame();
  }

  function disposeGraphics() {
    for (const resource of resources) resource.dispose?.();
    resources.clear();
    renderer?.dispose();
    renderer?.domElement.remove();
  }

  function onPageHide(event) {
    if (event.persisted) {
      stopFrames();
      return;
    }
    disposed = true;
    stopFrames();
    window.removeEventListener("resize", resize);
    window.removeEventListener("prospect:location", onLocation);
    document.removeEventListener("visibilitychange", onVisibility);
    motionPreference.removeEventListener("change", onMotionPreference);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide);
    motionButton?.removeEventListener("click", onPause);
    disposeGraphics();
  }

  function onPageShow() {
    if (!disposed) requestFrame();
  }

  renderer.domElement.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    fallback();
  });
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("prospect:location", onLocation);
  document.addEventListener("visibilitychange", onVisibility);
  motionPreference.addEventListener("change", onMotionPreference);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  motionButton?.addEventListener("click", onPause);
  if (window.prospectLocationTarget) moveTo(window.prospectLocationTarget);

  function loadTexture(name, path, colorTexture, apply, onFailure) {
    textureStatus[name].path = path;
    textureLoader.load(path, texture => {
      if (disposed || failed) { texture.dispose(); return; }
      keep(texture);
      texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(textureProfile === "mobile" ? 4 : 8,
        renderer.capabilities.getMaxAnisotropy());
      texture.wrapS = THREE.RepeatWrapping;
      textureStatus[name] = {
        loaded: true, path,
        width: texture.image.naturalWidth || texture.image.width,
        height: texture.image.naturalHeight || texture.image.height
      };
      apply(texture);
      requestFrame();
    }, undefined, () => {
      if (!disposed && !failed) onFailure?.();
    });
  }

  const standardDay = host.dataset.earthDay || "/assets/earth-day.jpg";
  const highResolutionAllowed = textureProfile === "desktop" &&
    renderer.capabilities.maxTextureSize >= 4096 && !navigator.connection?.saveData;
  const dayPath = highResolutionAllowed && host.dataset.earthDayDesktop
    ? host.dataset.earthDayDesktop : standardDay;
  const applyDay = texture => {
    planetMaterial.map = texture;
    planetMaterial.needsUpdate = true;
  };
  loadTexture("day", dayPath, true, applyDay, () => {
    if (dayPath !== standardDay) {
      loadTexture("day", standardDay, true, applyDay, fallback);
    } else fallback();
  });
  if (host.dataset.earthNight) {
    loadTexture("night", host.dataset.earthNight, true, addNightLights);
  }
  if (host.dataset.earthClouds) {
    const cloudPath = highResolutionAllowed && host.dataset.earthCloudsDesktop
      ? host.dataset.earthCloudsDesktop : host.dataset.earthClouds;
    loadTexture("clouds", cloudPath, true, addClouds, () => {
      if (cloudPath !== host.dataset.earthClouds) {
        loadTexture("clouds", host.dataset.earthClouds, true, addClouds);
      }
    });
  }
  if (host.dataset.earthSpecular) {
    loadTexture("specular", host.dataset.earthSpecular, false, texture => {
      planetMaterial.specularMap = texture;
      planetMaterial.needsUpdate = true;
    });
  }
}

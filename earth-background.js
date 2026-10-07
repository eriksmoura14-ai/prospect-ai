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
  let inViewport = true;
  let currentTarget = null;
  let targetCountry = "";
  let pendingFrame = 0;
  let previousFrame = 0;
  let needsPaint = true;
  let frameCount = 0;
  let labelUpdates = 0;
  let labelDirty = true;
  let viewWidth = 0;
  let viewHeight = 0;
  let guideWidth = 0;
  let labelWidth = 0;
  let labelHeight = 0;
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
  let leader;
  let resizeObserver;
  let viewportObserver;
  const resources = new Set();
  const textureLoader = new THREE.TextureLoader();
  const earthRadius = 1.72;
  const textureProfile = window.innerWidth <= 640 ? "mobile" : "desktop";
  const textureStatus = Object.fromEntries(["day", "night", "clouds", "specular"]
    .map(name => [name, { loaded: false, width: 0, height: 0, path: "" }]));
  const starStatus = { layers: 0, count: 0, galacticCount: 0 };
  const defaultRotation = new THREE.Quaternion()
    .fromArray(geographicQuaternion(14, -65));
  const targetScales = { country: 1, state: 1.08, city: 1.16 };
  const lightDirection = new THREE.Vector3(-2.3, 3.6, 7.2).normalize();
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
  const svgNamespace = "http://www.w3.org/2000/svg";
  const locationGuide = document.createElementNS(svgNamespace, "svg");
  locationGuide.classList.add("earth-location-guide");
  locationGuide.setAttribute("aria-hidden", "true");
  locationGuide.setAttribute("hidden", "");
  leader = document.createElementNS(svgNamespace, "polyline");
  leader.classList.add("earth-location-leader");
  const guideHalo = document.createElementNS(svgNamespace, "circle");
  guideHalo.classList.add("earth-location-halo");
  guideHalo.setAttribute("r", "11");
  const guideCore = document.createElementNS(svgNamespace, "circle");
  guideCore.classList.add("earth-location-core");
  guideCore.setAttribute("r", "5.5");
  locationGuide.append(leader, guideHalo, guideCore);
  host.append(locationGuide);

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
        return ready && !failed && !paused && !reducedMotion && !document.hidden && inViewport;
      },
      get graphics() {
        return {
          profile: textureProfile,
          fpsLimit: 30,
          labelUpdates,
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
    locationGuide.setAttribute("hidden", "");
    updateMotionButton();
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power"
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
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
      specular: 0x142d50,
      shininess: 62
    }));
    // Blue Marble uses almost-black water. The existing specular texture is
    // its matching water mask, so brighten oceans without tinting continents
    // or changing any geographic detail from the original NASA texture.
    planetMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        #ifdef USE_SPECULARMAP
          float ocean = texture2D(specularMap, vSpecularMapUv).r;
          vec3 oceanBlue = vec3(0.006, 0.026, 0.11);
          diffuseColor.rgb = mix(diffuseColor.rgb,
            max(diffuseColor.rgb, oceanBlue), ocean * 0.94);
          diffuseColor.rgb = mix(diffuseColor.rgb,
            pow(diffuseColor.rgb, vec3(0.85)), (1.0 - ocean) * 0.3);
        #endif
      `);
    };
    planetMaterial.customProgramCacheKey = () => "prospect-earth-ocean-v2";
    earth.add(new THREE.Mesh(sphere, planetMaterial));
    scene.add(new THREE.AmbientLight(0xc6daff, 0.46));
    const sunlight = new THREE.DirectionalLight(0xfffaf2, 3.5);
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
        dayColor: { value: new THREE.Color(0x68d0ff) },
        nightColor: { value: new THREE.Color(0x176eff) },
        haloStrength: { value: 1.1 },
        falloff: { value: 3.6 }
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
        uniform float haloStrength;
        uniform float falloff;
        varying vec3 vWorldNormal;
        varying vec3 vView;
        void main() {
          vec3 normal = normalize(vWorldNormal);
          float grazing = 1.0 - abs(dot(normal, normalize(vView)));
          float opticalDepth = pow(clamp(grazing, 0.0, 1.0), falloff);
          float day = smoothstep(-0.25, 0.6, dot(normal, sunlight));
          vec3 scatteredLight = mix(nightColor, dayColor, day);
          gl_FragColor = vec4(scatteredLight,
            opticalDepth * (0.48 + day * 0.52) * haloStrength);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const shell = keep(new THREE.SphereGeometry(earthRadius * 1.008,
      segments, segments));
    earth.add(new THREE.Mesh(shell, material));
    // A static, soft light profile supplies atmospheric bloom without an
    // expensive full-canvas post-processing pass or a hard second sphere.
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 256;
    const context = haloCanvas.getContext("2d");
    if (context) {
      const bloom = context.createRadialGradient(128, 128, 0, 128, 128, 128);
      for (const [stop, color] of [
        [0, "rgba(0, 140, 255, 0)"], [0.73, "rgba(0, 140, 255, 0)"],
        [0.79, "rgba(30, 154, 255, .07)"], [0.818, "rgba(50, 185, 255, .32)"],
        [0.836, "rgba(25, 159, 255, .95)"], [0.851, "rgba(18, 113, 255, .72)"],
        [0.88, "rgba(0, 130, 255, .19)"], [0.94, "rgba(0, 116, 255, .04)"],
        [1, "rgba(0, 116, 255, 0)"]
      ]) bloom.addColorStop(stop, color);
      context.fillStyle = bloom;
      context.fillRect(0, 0, 256, 256);
      const haloMaterial = keep(new THREE.SpriteMaterial({
        map: keep(new THREE.CanvasTexture(haloCanvas)),
        transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false
      }));
      const halo = new THREE.Sprite(haloMaterial);
      halo.scale.setScalar(earthRadius * 2 * 1.24);
      earth.add(halo);
    }
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
    const material = keep(new THREE.ShaderMaterial({
      uniforms: {
        cloudTexture: { value: texture },
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
        uniform sampler2D cloudTexture;
        uniform vec3 sunlight;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          // Read coverage from alpha explicitly; transparent cloud gaps must
          // reveal the surface, rather than introducing an opaque dark layer.
          float coverage = texture2D(cloudTexture, vUv).a;
          float day = smoothstep(-0.12, 0.6,
            dot(normalize(vWorldNormal), sunlight));
          vec3 cloudLight = mix(vec3(0.12, 0.19, 0.30),
            vec3(1.3, 1.36, 1.4), day);
          gl_FragColor = vec4(cloudLight, coverage * 0.88);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false
    }));
    clouds = new THREE.Mesh(geometry, material);
    earth.add(clouds);
  }

  function createMarker() {
    const group = new THREE.Group();
    const core = keep(new THREE.SphereGeometry(0.046, 16, 12));
    const cyan = keep(new THREE.MeshBasicMaterial({ color: 0x20e7f1 }));
    group.add(new THREE.Mesh(core, cyan));
    const innerRing = keep(new THREE.TorusGeometry(0.067, 0.003, 8, 48));
    const outerRing = keep(new THREE.TorusGeometry(0.105, 0.0018, 8, 48));
    group.add(new THREE.Mesh(innerRing, cyan));
    const translucent = keep(new THREE.MeshBasicMaterial({
      color: 0x20e7f1, transparent: true, opacity: 0.48, depthWrite: false
    }));
    group.add(new THREE.Mesh(outerRing, translucent));
    const spriteMaterial = keep(new THREE.SpriteMaterial({
      map: softDotTexture("32, 231, 241"),
      color: 0x20e7f1,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow = new THREE.Sprite(spriteMaterial);
    glow.scale.setScalar(0.4);
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
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    const mobile = textureProfile === "mobile";
    viewWidth = width; viewHeight = height;
    const hostBox = host.getBoundingClientRect();
    const heroBox = host.closest(".hero-copy")?.getBoundingClientRect();
    const availableRight = Math.min(window.innerWidth - 12,
      heroBox?.right ?? hostBox.right) - hostBox.left;
    guideWidth = Math.max(width, Math.min(width + (mobile ? 32 : 110), availableRight));
    labelWidth = labelHeight = 0; labelDirty = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
      mobile ? 1.25 : 1.5));
    renderer.setSize(width, height, false);
    locationGuide.setAttribute("viewBox", `0 0 ${guideWidth} ${height}`);
    locationGuide.style.width = `${guideWidth}px`;
    camera.aspect = width / height;
    // Fit the complete atmosphere at the largest city zoom in the narrower
    // host dimension. Perspective and canvas dimensions use the same aspect,
    // so the sphere stays circular at every responsive breakpoint.
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const limitingHalfFov = Math.atan(Math.tan(halfFov) * Math.min(1, camera.aspect));
    const largestRadius = earthRadius * targetScales.city * 1.055;
    camera.position.z = largestRadius / Math.sin(Math.atan(Math.tan(limitingHalfFov) * 0.93));
    camera.updateProjectionMatrix();
    globePlacement.position.set(0, 0, 0);
    globePlacement.quaternion.identity();
    requestFrame();
  }

  function requestFrame(forcePaint = true) {
    if (forcePaint) needsPaint = true;
    if (disposed || failed || document.hidden || !inViewport || pendingFrame) return;
    pendingFrame = requestAnimationFrame(renderFrame);
  }

  function stopFrames() {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    previousFrame = 0;
  }

  function renderFrame(now) {
    pendingFrame = 0;
    if (disposed || failed || document.hidden || !inViewport) return;
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
      if (labelDirty) {
        positionLocationLabel();
        labelDirty = Boolean(journey);
      }
    } catch {
      fallback();
      return;
    }
    if (!reducedMotion && !paused && ready) requestFrame(false);
  }

  function showLocation() {
    labelDirty = true;
    labelWidth = labelHeight = 0;
    locationLabel.hidden = !ready || !currentTarget || !currentTarget.label;
    locationGuide.toggleAttribute("hidden", locationLabel.hidden);
    if (locationLabel.hidden) return;
    locationKicker.textContent = {
      country: "PAÍS SELECIONADO",
      state: "REGIÃO SELECIONADA",
      city: "DESTINO SELECIONADO"
    }[currentTarget.stage];
    locationName.textContent = targetCountry && currentTarget.stage !== "country"
      ? `${currentTarget.label}, ${targetCountry}` : currentTarget.label;
  }

  const labelPoint = new THREE.Vector3();
  const earthCenter = new THREE.Vector3();
  const labelNormal = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();

  function positionLocationLabel() {
    if (!ready || !currentTarget?.label || !marker.visible) {
      locationLabel.hidden = true;
      locationGuide.setAttribute("hidden", "");
      return;
    }
    labelUpdates++;
    marker.getWorldPosition(labelPoint);
    earth.getWorldPosition(earthCenter);
    labelNormal.copy(labelPoint).sub(earthCenter).normalize();
    viewDirection.copy(camera.position).sub(labelPoint).normalize();
    const facesViewer = labelNormal.dot(viewDirection) > 0.05;
    labelPoint.project(camera);
    if (!facesViewer || labelPoint.z > 1 || Math.abs(labelPoint.x) > 1.05 ||
        Math.abs(labelPoint.y) > 1.05) {
      locationLabel.hidden = true;
      locationGuide.setAttribute("hidden", "");
      return;
    }
    locationLabel.hidden = false;
    locationGuide.removeAttribute("hidden");
    const width = viewWidth;
    const height = viewHeight;
    const pointX = (labelPoint.x + 1) * width / 2;
    const pointY = (1 - labelPoint.y) * height / 2;
    if (!labelWidth) labelWidth = locationLabel.offsetWidth || Math.min(190, width - 24);
    if (!labelHeight) labelHeight = locationLabel.offsetHeight || 24;
    const labelX = Math.max(12, guideWidth - labelWidth - 8);
    const labelY = Math.max(12,
      Math.min(height - labelHeight - 20,
        pointY + (labelX < pointX + 12 ? 17 : 5)));
    locationLabel.style.left = `${labelX}px`;
    locationLabel.style.top = `${labelY}px`;
    const lineY = labelY + labelHeight + 3;
    const lineEnd = guideWidth - 8;
    const elbowX = Math.max(pointX + 18, labelX - 7);
    leader.setAttribute("points", `${pointX},${pointY} ${Math.min(lineEnd, elbowX)},${lineY} ${lineEnd},${lineY}`);
    for (const dot of [guideHalo, guideCore]) {
      dot.setAttribute("cx", pointX);
      dot.setAttribute("cy", pointY);
    }
  }

  function moveTo(detail) {
    const nextTarget = validLocation(detail);
    targetCountry = "";
    if (nextTarget && typeof detail.countryCode === "string" &&
        /^[A-Z]{2}$/.test(detail.countryCode)) {
      try {
        targetCountry = new Intl.DisplayNames(["pt-BR"], { type: "region" })
          .of(detail.countryCode) || "";
      } catch { /* The place name remains available without DisplayNames. */ }
    }
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
    // Move the selected point a little down and right on the visible globe,
    // making room for the callout without changing its actual coordinates.
    if (nextTarget) orientation.premultiply(new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.18, 0.30, 0, "YXZ")));
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
    const icon = document.createElementNS(svgNamespace, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("aria-hidden", "true");
    const symbol = document.createElementNS(svgNamespace, "path");
    symbol.setAttribute("d", paused ? "M8 5 19 12 8 19Z" : "M8 5v14M16 5v14");
    symbol.setAttribute("fill", paused ? "currentColor" : "none");
    symbol.setAttribute("stroke", "currentColor");
    symbol.setAttribute("stroke-width", paused ? "1" : "3");
    symbol.setAttribute("stroke-linecap", "round");
    symbol.setAttribute("stroke-linejoin", "round");
    icon.append(symbol);
    motionButton.replaceChildren(icon);
    motionButton.setAttribute("aria-label", label);
    motionButton.setAttribute("aria-pressed", String(paused));
    motionButton.title = label;
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
    resizeObserver?.disconnect();
    viewportObserver?.disconnect();
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
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
  }
  if (window.IntersectionObserver) {
    viewportObserver = new IntersectionObserver(entries => {
      inViewport = entries.some(entry => entry.isIntersecting);
      if (inViewport) requestFrame();
      else stopFrames();
    }, { rootMargin: "120px" });
    viewportObserver.observe(host);
  }
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

import * as THREE from "three";
import { resolveRenderSize, type ResolvedRenderSize } from "../render-size";
import type { Activity, ActivityContext, ProjectionSettings } from "../types";
import {
  CosmosModel,
  COSMOS_ID,
  MAX_COMETS,
  MAX_STARS,
} from "./astronomy-model";
import { createAstronomyAudio } from "./astronomy-audio";
import { createPlanetSystems, PLANET_ASSETS } from "./astronomy-planets";

const ROOT = `${import.meta.env.BASE_URL}assets/scenes/`;
const vertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const backgroundFragment = `varying vec2 vUv;uniform sampler2D uMap;uniform float uTime;uniform float uAspect;uniform float uLight;
void main(){
 vec2 uv=vUv;float ratio=(1.0/uAspect)/1.5;
 if(ratio>1.0)uv.y=(uv.y-.5)/ratio+.5;else uv.x=(uv.x-.5)*ratio+.5;
 // Almost imperceptible depth drift, rather than scrolling the whole star field.
 uv+=vec2(sin(uTime*.025),cos(uTime*.021))*.0015;
 vec3 c=texture2D(uMap,uv).rgb;
 float breath=.98+.02*sin(uTime*.11+vUv.x*5.0);
 gl_FragColor=vec4(c*breath*(.82+uLight*.25),1.0);
 #include <colorspace_fragment>
}`;
const starVertex = `attribute float aSize;attribute float aPhase;attribute float aGlow;attribute vec3 aColor;varying vec3 vColor;varying float vAlpha;uniform float uTime;uniform float uScale;uniform float uLight;
void main(){float shimmer=.83+.17*sin(uTime*(.45+aPhase*.045)+aPhase);vColor=aColor;vAlpha=(.48+uLight*.50)*shimmer+aGlow*.5;gl_PointSize=min(36.0,aSize*uScale*(1.0+aGlow*.8));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const starFragment = `varying vec3 vColor;varying float vAlpha;
void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=length(p);if(r>1.0)discard;float core=exp(-r*r*15.0);float glow=exp(-r*r*4.5)*.28;float rays=exp(-min(abs(p.x),abs(p.y))*24.0)*pow(1.0-r,2.0)*.30;gl_FragColor=vec4(vColor,(core+glow+rays)*vAlpha);
 #include <colorspace_fragment>
}`;
/** A scene-owned renderer; shared camera mapping and projection geometry stay unchanged. */
export function createAstronomyActivity(context: ActivityContext): Activity {
  const renderer = new THREE.WebGLRenderer({
    canvas: context.canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x020511, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 2 / 3, 0, 0.01, 10);
  camera.position.z = 4;
  const model = new CosmosModel();
  const audio = createAstronomyAudio();
  let settings = context.settings,
    aspect = 2 / 3,
    drift = 0.35,
    light = 0.8,
    disposed = false;
  let allocation: ResolvedRenderSize | undefined;
  let assetError = "",
    frames = 0;
  const loaded = new Set<string>(),
    textures: THREE.Texture[] = [];
  function texture(name: string, data = false) {
    const t = new THREE.TextureLoader().load(
      `${ROOT}${name}`,
      () => {
        if (!disposed) loaded.add(name);
      },
      undefined,
      () => {
        if (!disposed)
          assetError = `Could not load scene artwork: assets/scenes/${name}`;
      },
    );
    t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = name.endsWith(".jpg")
      ? THREE.RepeatWrapping
      : THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    textures.push(t);
    return t;
  }
  const backgroundMaterial = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: backgroundFragment,
    uniforms: {
      uMap: { value: texture("astronomy-nebula.png") },
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uLight: { value: light },
    },
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    backgroundMaterial,
  );
  background.position.set(0.5, aspect / 2, -1);
  background.scale.y = aspect;
  background.renderOrder = -10;
  scene.add(background);
  scene.add(new THREE.AmbientLight(0xb6c3d1, 0.12));
  const sun = new THREE.DirectionalLight(0xfff7ed, 3.8);
  sun.position.set(-2.1, 2.5, 3.8);
  scene.add(sun);
  const sphereGeometry = new THREE.SphereGeometry(1, 96, 64);
  const planetSystems = createPlanetSystems(
    scene,
    sphereGeometry,
    model.planets,
    texture,
  );

  function pointCloud(capacity: number, z: number) {
    const geometry = new THREE.BufferGeometry();
    for (const [key, width] of [
      ["position", 3],
      ["aColor", 3],
      ["aSize", 1],
      ["aPhase", 1],
      ["aGlow", 1],
    ] as const)
      geometry.setAttribute(
        key,
        new THREE.BufferAttribute(
          new Float32Array(capacity * width),
          width,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uLight: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.position.z = z;
    points.frustumCulled = false;
    scene.add(points);
    return { geometry, material, points };
  }
  const stars = pointCloud(MAX_STARS, -0.15),
    effects = pointCloud(MAX_COMETS * (48 + 28), 0.25);
  const cool = new THREE.Color(0xb0dfff),
    warm = new THREE.Color(0xffe3ad),
    color = new THREE.Color();
  function upload() {
    const pos = stars.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const colors = stars.geometry.getAttribute(
      "aColor",
    ) as THREE.BufferAttribute;
    const sizes = stars.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const phases = stars.geometry.getAttribute(
      "aPhase",
    ) as THREE.BufferAttribute;
    const glows = stars.geometry.getAttribute("aGlow") as THREE.BufferAttribute;
    model.stars.forEach((star, i) => {
      pos.setXYZ(i, star.x, (1 - star.y) * aspect, 0);
      color.copy(cool).lerp(warm, star.warmth);
      colors.setXYZ(i, color.r, color.g, color.b);
      sizes.setX(i, star.size);
      phases.setX(i, star.phase);
      glows.setX(i, star.glow);
    });
    for (const attribute of [pos, colors, sizes, phases, glows])
      attribute.needsUpdate = true;
    stars.geometry.setDrawRange(0, model.stars.length);
    const ep = effects.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const ec = effects.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const es = effects.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const eg = effects.geometry.getAttribute("aGlow") as THREE.BufferAttribute;
    let n = 0;
    const add = (
      x: number,
      y: number,
      size: number,
      brightness: number,
      gold: boolean,
    ) => {
      if (x < 0 || x > 1 || y < 0 || y > aspect) return;
      ep.setXYZ(n, x, aspect - y, 0);
      es.setX(n, size);
      eg.setX(n, 0);
      const tint = gold ? warm : cool;
      ec.setXYZ(
        n,
        tint.r * brightness,
        tint.g * brightness,
        tint.b * brightness,
      );
      n++;
    };
    for (const burst of model.bursts) {
      const age = model.time - burst.born,
        fade = Math.exp(-age * 2.2);
      for (let i = 0; i < 28; i++) {
        const a = i * 2.399963,
          reach =
            (1 - Math.exp(-age * 3.4)) *
            (0.035 + (0.05 * (i % 5)) / 4) *
            burst.strength;
        add(
          burst.x + Math.cos(a) * reach,
          burst.y * aspect + Math.sin(a) * reach,
          3 + 5 * fade,
          fade * (0.65 + 0.35 * burst.strength),
          i % 3 === 0,
        );
      }
      add(burst.x, burst.y * aspect, 12 * fade + 1, fade * 0.6, true);
    }
    for (const comet of model.comets) {
      const age = model.time - comet.born,
        travel = age * (comet.origin === "ambient" ? 0.18 : 0.23),
        fade = Math.min(1, age * 8) * (1 - Math.max(0, age / comet.life) ** 2);
      for (let i = 0; i < 47; i++) {
        const tail = i / 46,
          distance = Math.max(0, travel - tail * Math.min(travel, 0.1));
        add(
          comet.x + comet.dx * distance,
          comet.y * aspect + comet.dy * distance,
          (i === 0 ? 14 : 6.5 * (1 - tail) + 1.2) *
            (comet.origin === "ambient" ? 0.8 : 1),
          fade * (1 - tail) ** 1.7 * (comet.origin === "ambient" ? 0.68 : 1),
          false,
        );
      }
    }
    for (const attribute of [ep, ec, es, eg]) attribute.needsUpdate = true;
    effects.geometry.setDrawRange(0, n);
    planetSystems.update(aspect);
  }
  function configure(next: ProjectionSettings) {
    if (disposed) return;
    settings = next;
    aspect = Math.max(
      0.375,
      Math.min(4 / 3, next.floorHeight / next.floorWidth),
    );
    const local = next.activitySettings[COSMOS_ID] ?? {};
    const value = (key: string, fallback: number, min: number, max: number) =>
      typeof local[key] === "number" && Number.isFinite(local[key])
        ? Math.max(min, Math.min(max, local[key] as number))
        : fallback;
    model.setCount(value("starCount", 200, 80, MAX_STARS));
    drift = value("drift", 0.35, 0, 1);
    light = value("starlight", 0.8, 0.3, 1);
    camera.top = aspect;
    camera.updateProjectionMatrix();
    background.position.y = aspect / 2;
    background.scale.y = aspect;
    backgroundMaterial.uniforms.uAspect.value = aspect;
    backgroundMaterial.uniforms.uLight.value = light;
    stars.material.uniforms.uLight.value = light;
    upload();
  }
  configure(settings);
  return {
    id: COSMOS_ID,
    title: "Starlit cosmos",
    audio,
    configure,
    update(dt, time, frame) {
      if (disposed || settings.paused || settings.blank) return [];
      const accepted = model.update(dt, time, aspect, drift, frame);
      upload();
      return accepted;
    },
    render() {
      if (disposed || settings.blank) return;
      if (assetError) throw new Error(assetError);
      allocation = resolveRenderSize({
        logicalWidth: 960,
        logicalHeight: Math.round(960 * aspect),
        cssWidth: context.canvas.clientWidth,
        cssHeight: context.canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
        previous: allocation,
      });
      if (allocation.changed)
        renderer.setSize(allocation.width, allocation.height, false);
      backgroundMaterial.uniforms.uTime.value = model.time;
      for (const cloud of [stars, effects]) {
        cloud.material.uniforms.uTime.value = model.time;
        cloud.material.uniforms.uScale.value = allocation.width / 960;
      }
      renderer.render(scene, camera);
      frames++;
    },
    diagnostics: () => ({
      frames,
      assetsLoaded: loaded.size === 1 + PLANET_ASSETS.length,
      assetError,
      stars: model.stars.length,
      planets: model.planets.length,
      impulseCount: model.impulseCount,
      responses: model.responses,
      comets: model.comets.length,
      ambientComets: model.comets.filter((comet) => comet.origin === "ambient")
        .length,
      ambientLaunches: model.ambientLaunches,
      positions: model.planets.map((p) => ({
        kind: p.kind,
        x: p.x,
        y: p.y,
        spin: p.spin,
      })),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      renderWidth: allocation?.width ?? 0,
      renderHeight: allocation?.height ?? 0,
      audio: audio.diagnostics(),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      audio.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          // Shared sphere geometry is released once below.
          if (object.geometry !== sphereGeometry) object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
      sphereGeometry.dispose();
      textures.forEach((t) => t.dispose());
      scene.clear();
      renderer.dispose();
    },
  };
}

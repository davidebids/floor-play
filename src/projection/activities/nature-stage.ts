import * as THREE from "three";
import { resolveRenderSize, type ResolvedRenderSize } from "../render-size";
import type {
  ActivityContext,
  InteractionFrame,
  ProjectionSettings,
} from "../types";

export type NatureMode = "forest" | "meadow" | "tide" | "beach";
export interface NatureSpec {
  id: string;
  title: string;
  mode: NatureMode;
  background: string;
}
export interface NatureSprite {
  x: number;
  y: number;
  size: number;
  angle: number;
  lift: number;
  flutter: number;
  opacity: number;
  bank?: number;
  gait?: number;
  gaitPhase?: number;
}
interface SpriteNode extends NatureSprite {
  asset: string;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}
export interface SurfaceMark {
  x: number;
  y: number;
  born: number;
  strength: number;
  kind: "tap" | "motion";
}
export const SURFACE_MARK_CAPACITY = { tap: 8, motion: 16 } as const;
const MARKS = SURFACE_MARK_CAPACITY.tap + SURFACE_MARK_CAPACITY.motion;
/** Sustained camera motion must not evict a tap while the hand still covers it. */
export function appendSurfaceMark(
  marks: SurfaceMark[],
  mark: SurfaceMark,
): void {
  if (
    marks.filter((m) => m.kind === mark.kind).length >=
    SURFACE_MARK_CAPACITY[mark.kind]
  )
    marks.splice(
      marks.findIndex((m) => m.kind === mark.kind),
      1,
    );
  marks.push(mark);
}
const beachFrontGLSL = `float beachFront(float x,float time,float motion){
 float cycle=time*(.105+.035*motion)+.025*sin(x*6.0);float phase=fract(cycle);
 float swash=phase<.36?smoothstep(0.0,.36,phase):1.0-smoothstep(.36,1.0,phase);
 return .075+(.105+.095*motion)*swash+.012*sin(x*8.0+time*.3)+.006*sin(x*19.0-time*.6);}`;
const vertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
function backgroundShader(mode: NatureMode): string {
  return `precision highp float;varying vec2 vUv;uniform sampler2D uMap;uniform float uTime;uniform vec2 uSize;uniform float uMotion;uniform float uLifetime;uniform vec4 uMarks[${MARKS}];uniform vec4 uPresence[12];
 ${mode === "beach" ? beachFrontGLSL : ""}
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 ${mode === "beach" ? `float shoreNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);}` : ""}
 void main(){vec2 uv=vUv;vec2 pixel=uv*uSize;vec2 offset=vec2(0.0);float shade=0.0;float glint=0.0;float water=0.0;
 ${mode === "tide" ? `water=1.0-smoothstep(.82,1.08,length((uv-.5)/vec2(.44,.43)));offset=vec2(sin(uv.y*27.0+uTime*.65),cos(uv.x*23.0-uTime*.58))*.0015*uMotion*water;` : ""}
 ${mode === "forest" || mode === "meadow" ? `offset=vec2(sin(uv.y*15.0+uTime*.5),sin(uv.x*11.0+uTime*.36))*.0007*uMotion;` : ""}
 for(int i=0;i<${MARKS};i++){vec4 m=uMarks[i];if(m.w<=0.0)continue;float age=uTime-m.z;if(age<0.0||age>uLifetime)continue;vec2 delta=pixel-m.xy*uSize;float d=length(delta);float power=m.w;float fade=1.0-smoothstep(uLifetime*.35,uLifetime,age);
 ${
   mode === "beach"
     ? `float radius=14.0+power*20.0;float dent=exp(-d*d/(radius*radius));float rim=exp(-pow((d-radius)/(radius*.20),2.0));shade+=dent*.12*power*fade;glint+=rim*.045*power*fade;offset+=delta/max(d,1.0)*dent*.0011*power*fade;`
     : mode === "tide"
       ? `float speed=95.0+power*25.0;for(int wave=0;wave<3;wave++){float t=age-float(wave)*.12;if(t<0.0)continue;float r=t*speed;float q=(d-r)/(5.0+t*1.8);float ring=exp(-q*q)*exp(-t*.82)*power*pow(.62,float(wave))/sqrt(1.0+r*.018);offset+=delta/max(d,1.0)*(-q)*ring*.007*water;glint+=max(0.0,1.0-q*q)*ring*.085*water;shade+=ring*.027*water;}`
       : mode === "forest"
         ? `shade+=exp(-d*d/1800.0)*fade*.04;glint+=exp(-d*d/(300.0+age*2000.0))*exp(-age*2.0)*power*.085;`
         : `glint+=exp(-d*d/(600.0+age*2500.0))*exp(-age*1.6)*power*.09;`
 }
 }
 vec3 color=texture2D(uMap,clamp(uv+offset,vec2(.001),vec2(.999))).rgb;
 ${mode === "forest" ? `float dap=sin(uv.x*19.0+sin(uv.y*8.0+uTime*.19))*sin(uv.y*16.0-uTime*.13);color*=.965+.035*dap;` : ""}
 ${mode === "meadow" ? `float sun=sin(uv.x*8.0+uv.y*13.0+sin(uTime*.16));color*=.98+.02*sun;` : ""}
 ${mode === "tide" ? `float a=sin(uv.x*62.0+sin(uv.y*27.0+uTime*.55)*1.9);float b=sin(uv.y*67.0+sin(uv.x*24.0-uTime*.4)*1.5);float caustic=pow(max(0.0,1.0-abs(a+b)*.7),9.0);color+=vec3(.055,.07,.05)*caustic*water;` : ""}
 ${
   mode === "beach"
     ? `
 // The source is dry sand, not a sea photograph. Keep its corner props out of the swash.
 if(uv.y<.36){
  vec2 cleanUv=vec2(.18+uv.x*.64,.34+uv.y*.8);
  vec3 cleanSand=texture2D(uMap,cleanUv+offset*.4).rgb;
  color=mix(cleanSand,color,smoothstep(.28,.36,uv.y));
  float line=beachFront(uv.x,uTime,uMotion);
  float edge=uv.y-line;
  float sea=1.0-smoothstep(-.003,.008,edge);
  float wetLine=max(line,max(beachFront(uv.x,uTime-.8,uMotion),beachFront(uv.x,uTime-1.8,uMotion)));
  float wet=1.0-smoothstep(wetLine+.008,wetLine+.045,uv.y);
  color*=mix(vec3(1.0),vec3(.74,.79,.77),wet*.65);
  float depth=clamp((line-uv.y)/.19,0.0,1.0);
  vec2 flow=vec2(sin(uv.y*66.0-uTime*1.1+sin(uv.x*19.0)),cos(uv.x*49.0+uTime*.7+uv.y*14.0));
  vec3 bed=texture2D(uMap,cleanUv+flow*.0025*depth).rgb;
  vec3 transmission=exp(-vec3(2.4,1.0,.65)*depth);
  vec3 waterColor=bed*transmission*.85+vec3(.12,.46,.47)*(1.0-transmission);
  float wave=sin(uv.y*103.0-uTime*1.5+sin(uv.x*22.0)*.9);
  float cross=sin(uv.x*87.0+uv.y*37.0+uTime*.6);
  float caustic=pow(max(0.0,1.0-abs(wave+cross)*.65),8.0);
  waterColor+=vec3(.045,.065,.057)*caustic*depth;
  waterColor+=vec3(.07,.13,.14)*depth*(.5+.5*flow.y)*.35;
  color=mix(color,waterColor,sea);
  // Advected continuous noise breaks a thin curling edge into translucent foam cells.
  vec2 foamUv=vec2(uv.x*82.0,(uv.y-line)*185.0-uTime*.4);
  float cells=shoreNoise(foamUv);
  float detail=shoreNoise(foamUv*2.7+vec2(uTime*.15,0.0));
  float foamEdge=edge+(shoreNoise(vec2(uv.x*35.0,uTime*.14))-.5)*.008;
  float lip=exp(-pow((foamEdge+.001)/.0045,2.0));
  float broken=smoothstep(.40,.73,cells*.7+detail*.3);
  float lace=exp(-pow((edge+.014)/.017,2.0))*broken*.65;
  float foam=clamp(lip*(.35+.65*detail)+lace,0.0,.9);
  color=mix(color,vec3(.89,.94,.90),foam*.80);
  shade*=1.0-sea;glint*=1.0-sea;
 }`
     : ""
 }
 for(int i=0;i<12;i++){vec4 p=uPresence[i];if(p.w<=0.0)continue;float d=length((uv-p.xy)*uSize);shade+=(1.0-smoothstep(0.0,max(12.0,p.z*uSize.x),d))*p.w*.025;}
 color=max(vec3(0.0),color*(1.0-min(.3,shade))+glint);gl_FragColor=vec4(color,1.0);}`;
}
const spriteVertex = `varying vec2 vUv;uniform float uFlutter;uniform float uBank;uniform float uKind;uniform float uGait;uniform float uGaitPhase;
void main(){vUv=uv;vec3 p=position;
if(uKind>1.5){float wing=smoothstep(.045,.40,abs(p.x));float fold=clamp(uFlutter+sign(p.x)*uBank*.18,0.0,1.0);float edge=max(0.0,abs(p.x)-.045);p.x=sign(p.x)*(min(abs(p.x),.045)+edge*(1.0-fold*.82));p.y+=wing*fold*(.05+.035*sin(position.y*4.0));}
else if(uKind>.5){float leg=smoothstep(.13,.31,abs(p.x));float side=sign(p.x);float stroke=uGaitPhase+position.y*22.0+(side<0.0?3.141593:0.0);p.y+=sin(stroke)*leg*uGait*.027;p.x+=cos(stroke)*leg*uGait*.012;}
gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`;
const spriteFragment = `precision highp float;varying vec2 vUv;uniform sampler2D uMap;uniform float uOpacity;uniform float uShadow;uniform float uKind;uniform float uFlutter;uniform float uBank;
void main(){vec4 t=texture2D(uMap,vUv);if(t.a<.025)discard;if(uKind>1.5){float wing=smoothstep(.045,.40,abs(vUv.x-.5));t.rgb*=1.0-wing*uFlutter*.15+uBank*(vUv.x-.5)*.08;}vec3 c=mix(t.rgb,vec3(.025,.04,.025),uShadow);gl_FragColor=vec4(c,t.a*uOpacity);}`;

export function beachShoreline(
  x: number,
  time: number,
  waveMotion: number,
): number {
  const motion = Math.max(0, Math.min(1, waveMotion));
  const cycle = time * (0.105 + 0.035 * motion) + 0.025 * Math.sin(x * 6),
    phase = cycle - Math.floor(cycle);
  const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const swash =
    phase < 0.36 ? smooth(0, 0.36, phase) : 1 - smooth(0.36, 1, phase);
  return (
    0.075 +
    (0.105 + 0.095 * motion) * swash +
    0.012 * Math.sin(x * 8 + time * 0.3) +
    0.006 * Math.sin(x * 19 - time * 0.6)
  );
}

/** Reusable photographic stage. Scenes own their behavior; this owns only graphics and feedback. */
export class NatureStage {
  readonly width = 960;
  height = 640;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 960, 0, 640, -100, 100);
  private geometry = new THREE.PlaneGeometry(1, 1, 24, 16);
  private background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private textures = new Map<string, THREE.Texture>();
  private loaded = new Set<string>();
  private nodes: SpriteNode[] = [];
  private marks: SurfaceMark[] = [];
  private seen = new Set<string>();
  private lastMotion = new Map<
    string,
    { x: number; y: number; time: number }
  >();
  private markData = Array.from({ length: MARKS }, () => new THREE.Vector4());
  private presenceData = Array.from({ length: 12 }, () => new THREE.Vector4());
  private allocation?: ResolvedRenderSize;
  private errors: string[] = [];
  private disposed = false;
  private frames = 0;
  private impulseCount = 0;
  private motionCount = 0;
  private currentTime = 0;
  constructor(
    context: ActivityContext,
    private spec: NatureSpec,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: context.canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x101816, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: backgroundShader(spec.mode),
      uniforms: {
        uMap: { value: this.texture(spec.background) },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(this.width, this.height) },
        uMotion: { value: 0.4 },
        uLifetime: { value: 3 },
        uMarks: { value: this.markData },
        uPresence: { value: this.presenceData },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.background.renderOrder = -10;
    this.scene.add(this.background);
    this.configure(context.settings);
  }
  private texture(path: string): THREE.Texture {
    const existing = this.textures.get(path);
    if (existing) return existing;
    const texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}${path}`,
      (t) => {
        if (this.disposed) {
          t.dispose();
          return;
        }
        this.loaded.add(path);
      },
      undefined,
      () => {
        if (!this.disposed)
          this.errors.push(`Could not load scene artwork: ${path}`);
      },
    );
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 4;
    this.textures.set(path, texture);
    return texture;
  }
  addSprite(asset: string, options: Partial<NatureSprite> = {}): NatureSprite {
    const texture = this.texture(asset);
    const material = (shadow: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: spriteVertex,
        fragmentShader: spriteFragment,
        uniforms: {
          uMap: { value: texture },
          uOpacity: { value: shadow ? 0.18 : 1 },
          uShadow: { value: shadow ? 1 : 0 },
          uFlutter: { value: 0 },
          uBank: { value: 0 },
          uKind: {
            value: asset.includes("butterfly")
              ? 2
              : asset.includes("crab")
                ? 1
                : 0,
          },
          uGait: { value: 0 },
          uGaitPhase: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const mesh = new THREE.Mesh(this.geometry, material(false)),
      shadow = new THREE.Mesh(this.geometry, material(true));
    mesh.frustumCulled = shadow.frustumCulled = false;
    shadow.renderOrder = 1;
    mesh.renderOrder = 2;
    this.scene.add(shadow, mesh);
    const node: SpriteNode = {
      asset,
      x: 0.5,
      y: 0.5,
      size: 0.08,
      angle: 0,
      lift: 0,
      flutter: 0,
      opacity: 1,
      ...options,
      mesh,
      shadow,
    };
    this.nodes.push(node);
    return node;
  }
  removeSprite(sprite: NatureSprite): void {
    const i = this.nodes.indexOf(sprite as SpriteNode);
    if (i < 0) return;
    const [n] = this.nodes.splice(i, 1);
    this.scene.remove(n.mesh, n.shadow);
    n.mesh.material.dispose();
    n.shadow.material.dispose();
  }
  configure(settings: ProjectionSettings): void {
    this.height = Math.max(
      360,
      Math.min(
        1280,
        Math.round((this.width * settings.floorHeight) / settings.floorWidth),
      ),
    );
    this.camera.bottom = this.height;
    this.camera.updateProjectionMatrix();
    this.background.position.set(this.width / 2, this.height / 2, -1);
    this.background.scale.set(this.width, this.height, 1);
    const local = settings.activitySettings[this.spec.id] ?? {};
    const value = (key: string, fallback: number) =>
      typeof local[key] === "number" ? (local[key] as number) : fallback;
    this.background.material.uniforms.uSize.value.set(this.width, this.height);
    this.background.material.uniforms.uMotion.value = Math.max(
      0,
      Math.min(
        1,
        value(
          this.spec.mode === "beach"
            ? "waveMotion"
            : this.spec.mode === "tide"
              ? "waterMotion"
              : "breeze",
          0.4,
        ),
      ),
    );
    this.background.material.uniforms.uLifetime.value =
      this.spec.mode === "beach"
        ? Math.max(2, Math.min(12, value("trailDuration", 7)))
        : 2.6;
  }
  react(frame: InteractionFrame, time: number): void {
    this.currentTime = time;
    const list = frame.presence.slice(0, 12);
    for (let i = 0; i < 12; i++) {
      const p = list[i];
      this.presenceData[i].set(
        p?.center.x ?? 0,
        p?.center.y ?? 0,
        p?.radius ?? 0,
        p?.confidence ?? 0,
      );
    }
    const append = (
      x: number,
      y: number,
      strength: number,
      kind: SurfaceMark["kind"],
    ) => {
      appendSurfaceMark(this.marks, { x, y, born: time, strength, kind });
    };
    for (const impulse of frame.impulses) {
      if (this.seen.has(impulse.id)) continue;
      this.seen.add(impulse.id);
      if (this.seen.size > 256)
        this.seen.delete(this.seen.values().next().value!);
      append(
        impulse.position.x,
        impulse.position.y,
        Math.max(0.75, impulse.strength),
        "tap",
      );
      this.impulseCount++;
    }
    for (const motion of frame.motion.slice(0, 6)) {
      if (motion.strength < 0.05) continue;
      const previous = this.lastMotion.get(motion.id);
      const distance = previous
        ? Math.hypot(
            motion.position.x - previous.x,
            motion.position.y - previous.y,
          )
        : 1;
      if (previous && (time - previous.time < 0.12 || distance < 0.008))
        continue;
      append(
        motion.position.x,
        motion.position.y,
        motion.strength * 0.55,
        "motion",
      );
      this.lastMotion.set(motion.id, {
        x: motion.position.x,
        y: motion.position.y,
        time,
      });
      this.motionCount++;
    }
    const lifetime = this.background.material.uniforms.uLifetime
      .value as number;
    this.marks = this.marks.filter(
      (mark) =>
        time - mark.born < lifetime &&
        (this.spec.mode !== "beach" ||
          mark.y >
            beachShoreline(
              mark.x,
              time,
              this.background.material.uniforms.uMotion.value,
            ) +
              0.015),
    );
    for (const [id, previous] of this.lastMotion)
      if (time - previous.time > 3) this.lastMotion.delete(id);
  }
  render(time: number): void {
    if (this.disposed) return;
    if (this.errors.length) throw new Error(this.errors[0]);
    this.currentTime = time;
    const canvas = this.renderer.domElement;
    const allocation = resolveRenderSize({
      logicalWidth: this.width,
      logicalHeight: this.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      previous: this.allocation,
    });
    if (allocation.changed)
      this.renderer.setSize(allocation.width, allocation.height, false);
    this.allocation = allocation;
    for (let i = 0; i < MARKS; i++) {
      const m = this.marks[i];
      this.markData[i].set(
        m?.x ?? 0,
        m?.y ?? 0,
        m?.born ?? 0,
        m?.strength ?? 0,
      );
    }
    this.background.material.uniforms.uTime.value = time;
    for (const n of this.nodes) {
      const size = n.size * this.width;
      const ready = this.loaded.has(n.asset);
      for (const mesh of [n.mesh, n.shadow]) {
        mesh.visible = ready && n.opacity > 0.001;
        mesh.scale.set(size, size, 1);
        mesh.rotation.z = n.angle;
        mesh.material.uniforms.uBank.value = Math.max(
          -1,
          Math.min(1, n.bank ?? 0),
        );
        mesh.material.uniforms.uGait.value = Math.max(
          0,
          Math.min(1, n.gait ?? 0),
        );
        mesh.material.uniforms.uGaitPhase.value = n.gaitPhase ?? time * 20;
        mesh.material.uniforms.uFlutter.value = Math.max(
          0,
          Math.min(1, n.flutter),
        );
      }
      n.mesh.position.set(n.x * this.width, n.y * this.height, 0);
      n.shadow.position.set(
        (n.x + 0.003 + n.lift * 0.3) * this.width,
        n.y * this.height + (n.lift + 0.004) * this.width,
        -0.2,
      );
      n.mesh.material.uniforms.uOpacity.value = Math.max(
        0,
        Math.min(1, n.opacity),
      );
      n.shadow.material.uniforms.uOpacity.value =
        0.16 * Math.max(0, Math.min(1, n.opacity));
    }
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }
  diagnostics(): Record<string, unknown> {
    const i = this.renderer.info;
    return {
      sceneId: this.spec.id,
      frames: this.frames,
      assetsLoaded: this.loaded.size === this.textures.size,
      assetError: this.errors[0] ?? "",
      artworkLoaded: this.loaded.size,
      artworkExpected: this.textures.size,
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      renderWidth: this.renderer.domElement.width,
      renderHeight: this.renderer.domElement.height,
      logicalWidth: this.width,
      logicalHeight: this.height,
      renderScale: this.allocation?.scale ?? 1,
      resolutionCapped: this.allocation?.capped ?? false,
      impulseCount: this.impulseCount,
      activeTapMarks: this.marks.filter((mark) => mark.kind === "tap").length,
      shoreline:
        this.spec.mode === "beach"
          ? beachShoreline(
              0.5,
              this.currentTime,
              this.background.material.uniforms.uMotion.value,
            )
          : undefined,
      motionCount: this.motionCount,
      activeMarks: this.marks.filter(
        (m) =>
          this.currentTime - m.born <
          (this.background.material.uniforms.uLifetime.value as number),
      ).length,
      sprites: this.nodes.length,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of [...this.nodes]) this.removeSprite(n);
    this.background.geometry.dispose();
    this.background.material.dispose();
    this.geometry.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.marks = [];
    this.lastMotion.clear();
    this.seen.clear();
  }
}

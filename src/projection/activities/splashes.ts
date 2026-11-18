import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../config";
import { clamp } from "../../math";
import { POND_SURFACE_BOUNDARY_GLSL } from "./pond-boundary";

export const SPLASH_CAPACITY = { impacts: 12, droplets: 256 } as const;
const GRAVITY = 460;
const IMPACT_LIFE = 2.4;
const LANDING_LIFE = 0.28;
interface Impact {
  alive: boolean;
  age: number;
  x: number;
  y: number;
  strength: number;
  seed: number;
}
interface Droplet {
  alive: boolean;
  age: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  vz: number;
  flight: number;
  size: number;
}
const noise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Analytic trajectories remain identical across frame rates and long render gaps. */
export function dropletTrajectory(
  p: Pick<Droplet, "x" | "y" | "dx" | "dy" | "vz" | "flight">,
  age: number,
) {
  const t = clamp(age, 0, p.flight);
  const height = Math.max(0, p.vz * t - 0.5 * GRAVITY * t * t);
  return {
    x: p.x + p.dx * t,
    y: p.y + p.dy * t - height * 0.65,
    height,
    angle: Math.atan2(p.dy - (p.vz - GRAVITY * t) * 0.65, p.dx),
  };
}

function quadGeometry(count: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  return geometry;
}
const impactVertex = `attribute vec4 event;attribute vec4 origin;varying vec2 vLocal;varying vec2 vWorld;varying vec4 vEvent;
void main(){vEvent=event;vLocal=position.xy*180.0;vec2 world=origin.xy+vLocal;vWorld=world;gl_Position=projectionMatrix*modelViewMatrix*vec4(world,0.0,1.0);}`;
const boundary = `uniform vec2 uResolution;${POND_SURFACE_BOUNDARY_GLSL}`;
const impactFragment = /* glsl */ `precision highp float;
varying vec2 vLocal;varying vec2 vWorld;varying vec4 vEvent;
${boundary}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 float age=vEvent.x; if(age<0.0||age>2.4)discard;
 float power=vEvent.y;float seed=vEvent.z;float scale=.65+power*.65;
 float d=length(vLocal);float angle=atan(vLocal.y,vLocal.x);
 float attack=smoothstep(0.0,.035,age);float crownFade=1.0-smoothstep(.14,.43,age);
 float lobe=sin(angle*9.0+seed)*.55+sin(angle*14.0-seed)*.25;
 float lift=sin(clamp(age/.43,0.0,1.0)*3.141593);
 float crownRadius=(7.0+30.0*(1.0-exp(-age*11.0))+(2.0+lobe*4.0)*lift)*scale;
 float crownD=length(vLocal+vec2(0.0,lift*(9.0+power*7.0)*scale));
 float skirt=exp(-pow((crownD-crownRadius)/(5.2*scale),2.0))*crownFade*attack;
 float lip=exp(-pow((crownD-crownRadius-1.5*scale)/(1.5*scale),2.0))*crownFade*attack;
 float directional=.45+.55*max(0.0,cos(angle+2.25));
 float broken=.6+.4*sin(angle*17.0+seed)*sin(angle*7.0-seed);
 float foam=skirt*pow(hash(floor(vLocal*1.2)+seed),9.0)*.25;
 float depression=(1.0-smoothstep(4.0*scale,17.0*scale,d))*(1.0-smoothstep(.05,.20,age));
 vec3 tint=vec3(.25,.39,.35);float alpha=depression*.20;
 float silver=lip*directional*broken*.92+foam;
 float body=skirt*.32;
 float rings=0.0;float trough=0.0;
 for(int i=0;i<4;i++){
   float t=age-float(i)*.11;if(t<0.0)continue;
   float r=5.0+t*(56.0+power*15.0);
   float fade=(1.0-smoothstep(.6,2.35,t))*exp(-t*.85)*pow(.73,float(i));
   float uneven=sin(angle*5.0+seed)*.35*sin(t*3.0);
   rings+=exp(-pow((d-r-uneven)/(1.05+t*.55),2.0))*fade;
   trough+=exp(-pow((d-r-2.3)/(1.5+t*.6),2.0))*fade;
 }
 float ringAlpha=rings*(.10+power*.07)*(.55+.45*directional);
 float dark=trough*.06+body;
 float bright=silver+ringAlpha;
 float total=alpha+dark+bright;
 tint=(tint*(alpha+dark)+vec3(.80,.91,.85)*bright)/max(total,.001);
 float water=smoothstep(0.0,5.0,pondWaterDistance(vWorld/uResolution,uResolution));
 gl_FragColor=vec4(tint,min(.8,total)*water);
}`;
const dropletVertex = `attribute vec4 shape;attribute vec4 origin;varying vec2 vUv;varying vec2 vWorld;varying vec2 vStyle;
void main(){vUv=position.xy;vStyle=vec2(origin.z,origin.w);float c=cos(shape.z);float s=sin(shape.z);vec2 local=position.xy*shape.xy;vec2 world=origin.xy+mat2(c,s,-s,c)*local;vWorld=world;gl_Position=projectionMatrix*modelViewMatrix*vec4(world,0.0,1.0);}`;
const dropletFragment = /* glsl */ `precision highp float;varying vec2 vUv;varying vec2 vWorld;varying vec2 vStyle;
${boundary}
void main(){float r=length(vUv);if(r>1.0)discard;float water=smoothstep(0.0,4.0,pondWaterDistance(vWorld/uResolution,uResolution));
 float opacity=vStyle.x;vec3 color;float alpha;
 if(vStyle.y>.5){float ring=exp(-pow((r-.72)/.12,2.0));alpha=ring*opacity*.28;color=vec3(.72,.85,.79);}
 else{float edge=1.0-smoothstep(.72,1.0,r);float rim=smoothstep(.40,.87,r)*.22;float glint=exp(-length(vUv-vec2(-.27,-.3))*7.0);color=mix(vec3(.42,.55,.48),vec3(.91,.98,.93),min(1.0,rim+glint));alpha=edge*opacity*(.25+glint*.70+rim*.35);}
 gl_FragColor=vec4(color,alpha*water);}`;

/** Two fixed draw calls: pooled coherent impacts and ballistic water droplets. */
export class SplashPass {
  readonly group = new THREE.Group();
  private readonly impacts: Impact[] = Array.from(
    { length: SPLASH_CAPACITY.impacts },
    () => ({ alive: false, age: 0, x: 0, y: 0, strength: 0, seed: 0 }),
  );
  private readonly droplets: Droplet[] = Array.from(
    { length: SPLASH_CAPACITY.droplets },
    () => ({
      alive: false,
      age: 0,
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      vz: 0,
      flight: 0,
      size: 0,
    }),
  );
  private readonly impactGeometry = quadGeometry(SPLASH_CAPACITY.impacts);
  private readonly dropletGeometry = quadGeometry(SPLASH_CAPACITY.droplets);
  private readonly events = new Float32Array(SPLASH_CAPACITY.impacts * 4);
  private readonly impactOrigins = new Float32Array(
    SPLASH_CAPACITY.impacts * 4,
  );
  private readonly shapes = new Float32Array(SPLASH_CAPACITY.droplets * 4);
  private readonly dropletOrigins = new Float32Array(
    SPLASH_CAPACITY.droplets * 4,
  );
  private readonly impactMaterial: THREE.ShaderMaterial;
  private readonly dropletMaterial: THREE.ShaderMaterial;
  private nextImpact = 0;
  private nextDroplet = 0;
  private lastTime: number | undefined;
  private disposed = false;

  constructor() {
    const attribute = (array: Float32Array) =>
      new THREE.InstancedBufferAttribute(array, 4).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.impactGeometry.setAttribute("event", attribute(this.events));
    this.impactGeometry.setAttribute("origin", attribute(this.impactOrigins));
    this.dropletGeometry.setAttribute("shape", attribute(this.shapes));
    this.dropletGeometry.setAttribute("origin", attribute(this.dropletOrigins));
    const material = (vertexShader: string, fragmentShader: string) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uResolution: {
            value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT),
          },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        vertexShader,
        fragmentShader,
      });
    this.impactMaterial = material(impactVertex, impactFragment);
    this.dropletMaterial = material(dropletVertex, dropletFragment);
    for (const [geometry, mat, order] of [
      [this.impactGeometry, this.impactMaterial, 20],
      [this.dropletGeometry, this.dropletMaterial, 21],
    ] as const) {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
    }
    this.writeAttributes();
  }
  spawn(x: number, y: number, strength: number) {
    if (this.disposed || !Number.isFinite(x + y + strength)) return;
    const power = clamp(strength, 0, 1),
      sequence = this.nextImpact++;
    Object.assign(this.impacts[sequence % SPLASH_CAPACITY.impacts], {
      alive: true,
      age: 0,
      x,
      y,
      strength: power,
      seed: noise(sequence + 1) * 6.28,
    });
    const amount = Math.round(12 + power * 20);
    for (let i = 0; i < amount; i++) {
      const p = this.droplets[this.nextDroplet++ % SPLASH_CAPACITY.droplets];
      const angle = (i / amount) * Math.PI * 2 + noise(sequence * 73 + i) * 0.3;
      const speed = (35 + power * 58) * (0.55 + noise(i * 7 + sequence) * 0.55);
      const vz = (61 + power * 62) * (0.65 + noise(i * 11 + sequence) * 0.55);
      Object.assign(p, {
        alive: true,
        age: 0,
        x: x + Math.cos(angle) * 6,
        y: y + Math.sin(angle) * 6,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        vz,
        flight: (2 * vz) / GRAVITY,
        size: 1.0 + power * 0.65 + noise(i * 3) * 0.55,
      });
    }
  }
  update(time: number) {
    if (this.disposed) return;
    const dt =
      this.lastTime === undefined ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    for (const impact of this.impacts)
      if (impact.alive) {
        impact.age += dt;
        if (impact.age >= IMPACT_LIFE) impact.alive = false;
      }
    for (const droplet of this.droplets)
      if (droplet.alive) {
        droplet.age += dt;
        if (droplet.age >= droplet.flight + LANDING_LIFE) droplet.alive = false;
      }
    this.writeAttributes();
  }
  private writeAttributes() {
    for (const mat of [this.impactMaterial, this.dropletMaterial])
      mat.uniforms.uResolution.value.set(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.impacts.forEach((p, i) => {
      const k = i * 4;
      this.events.set([p.alive ? p.age : -1, p.strength, p.seed, 0], k);
      this.impactOrigins.set([p.x, p.y, 0, 0], k);
    });
    this.droplets.forEach((p, i) => {
      const k = i * 4;
      if (!p.alive) {
        this.shapes.set([0, 0, 0, 0], k);
        this.dropletOrigins[k + 2] = 0;
        return;
      }
      const trajectory = dropletTrajectory(p, p.age),
        landing = p.age >= p.flight;
      const fade = landing ? 1 - (p.age - p.flight) / LANDING_LIFE : 1;
      const radius = landing ? 1 + (p.age - p.flight) * 20 : p.size;
      this.shapes.set(
        [
          radius * (landing ? 1 : 1.35),
          radius,
          landing ? 0 : trajectory.angle,
          0,
        ],
        k,
      );
      this.dropletOrigins.set(
        [trajectory.x, trajectory.y, fade, landing ? 1 : 0],
        k,
      );
    });
    for (const name of ["event", "origin"])
      this.impactGeometry.getAttribute(name).needsUpdate = true;
    for (const name of ["shape", "origin"])
      this.dropletGeometry.getAttribute(name).needsUpdate = true;
    this.group.visible =
      this.impacts.some((p) => p.alive) || this.droplets.some((p) => p.alive);
  }
  diagnostics() {
    return {
      impacts: this.impacts.filter((p) => p.alive).length,
      droplets: this.droplets.filter((p) => p.alive).length,
      capacity: SPLASH_CAPACITY,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of [...this.impacts, ...this.droplets]) p.alive = false;
    this.impactGeometry.dispose();
    this.dropletGeometry.dispose();
    this.impactMaterial.dispose();
    this.dropletMaterial.dispose();
    this.group.clear();
    this.group.visible = false;
  }
}

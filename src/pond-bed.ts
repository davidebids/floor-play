import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH, POND_BED } from "./config";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uResolution;
  uniform sampler2D uBed;
  uniform float uBedLoaded;
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSpeckColor;
  uniform float uVerticalTone;
  uniform float uGrainScale;
  uniform float uEdgeDarkening;
  varying vec2 vUv;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  void main() {
    float verticalTone = smoothstep(0.0, 1.0, vUv.y) * uVerticalTone;
    vec3 color = mix(uDeepColor, uShallowColor, verticalTone);

    vec2 grainCell = floor(
      vUv * uResolution * uGrainScale
    );
    float grain = hash21(grainCell);
    float darkSpeck = smoothstep(0.975, 0.998, grain);
    color -= darkSpeck * uSpeckColor;

    float edgeDepth = smoothstep(0.48, 0.82, length((vUv - 0.5) * vec2(1.0, 1.25)));
    color *= 1.0 - edgeDepth * uEdgeDarkening;

    if(uBedLoaded>.5){
      vec2 uv=vec2(vUv.x,1.0-vUv.y);
      vec2 centered=(uv-.5)/vec2(.47,.44);
      float edge=pow(pow(abs(centered.x),5.0)+pow(abs(centered.y),5.0),.2);
      float water=1.0-smoothstep(.79,1.0,edge);
      vec3 photo=texture2D(uBed,uv).rgb;
      float depth=(1.0-smoothstep(.25,.92,edge));
      photo*=mix(vec3(1.0),vec3(.53,.72,.66),water*.82);
      photo*=1.0-depth*.15;
      float a=sin(uv.x*64.0+sin(uv.y*32.0+uTime*.48)*1.7+uTime*.6);
      float b=sin(uv.y*69.0+sin(uv.x*34.0-uTime*.37)*1.8-uTime*.51);
      float caustic=pow(max(0.0,1.0-abs(a+b)*.75),10.0);
      photo+=vec3(.095,.12,.075)*caustic*water;
      float foliage=sin(uv.x*14.0+uv.y*5.0+sin(uTime*.09))*.5+.5;
      float shade=smoothstep(.45,.94,uv.y)*pow(foliage,3.0)*.10;
      photo*=1.0-shade;
      color=photo;
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface RuntimePondBedAppearance {
  deepColor: THREE.Color;
  shallowColor: THREE.Color;
  speckColor: THREE.Color;
  verticalTone: number;
  grainScale: number;
  edgeDarkening: number;
}

function pondBedAppearanceFromConfig(): RuntimePondBedAppearance {
  return {
    deepColor: new THREE.Color().setRGB(...POND_BED.deepColor),
    shallowColor: new THREE.Color().setRGB(...POND_BED.shallowColor),
    speckColor: new THREE.Color().setRGB(...POND_BED.speckColor),
    verticalTone: POND_BED.verticalTone,
    grainScale: POND_BED.grainScale,
    edgeDarkening: POND_BED.edgeDarkening,
  };
}

export class PondBedPass {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private readonly material: THREE.ShaderMaterial;
  private readonly currentAppearance = pondBedAppearanceFromConfig();
  private targetAppearance = pondBedAppearanceFromConfig();
  private previousTime = -1;
  private disposed = false;
  private texture: THREE.Texture;
  public assetError = "";
  public get assetLoaded(): boolean {
    return this.material.uniforms.uBedLoaded.value > 0;
  }

  public constructor() {
    this.texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}assets/pond-bed.png`,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        this.material.uniforms.uBedLoaded.value = 1;
      },
      undefined,
      () => {
        if (!this.disposed) this.assetError = "Could not load pond artwork.";
      },
    );
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT) },
        uBed: { value: this.texture },
        uBedLoaded: { value: 0 },
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color() },
        uShallowColor: { value: new THREE.Color() },
        uSpeckColor: { value: new THREE.Color() },
        uVerticalTone: { value: 0 },
        uGrainScale: { value: 0 },
        uEdgeDarkening: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CANVAS_WIDTH, CANVAS_HEIGHT),
      this.material,
    );
    this.mesh.position.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, -1);
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.applyUniforms();
  }

  public refreshConfig(): void {
    this.targetAppearance = pondBedAppearanceFromConfig();
  }

  public resize(width: number, height: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.set(width * 0.5, height * 0.5, -1);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  public update(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (this.previousTime >= 0) {
      const deltaTime = Math.min(0.1, Math.max(0, time - this.previousTime));
      const blend = 1 - Math.exp(-deltaTime * 2.25);
      const current = this.currentAppearance;
      const target = this.targetAppearance;
      current.deepColor.lerp(target.deepColor, blend);
      current.shallowColor.lerp(target.shallowColor, blend);
      current.speckColor.lerp(target.speckColor, blend);
      current.verticalTone +=
        (target.verticalTone - current.verticalTone) * blend;
      current.grainScale += (target.grainScale - current.grainScale) * blend;
      current.edgeDarkening +=
        (target.edgeDarkening - current.edgeDarkening) * blend;
    }
    this.previousTime = time;
    this.applyUniforms();
  }

  public dispose(): void {
    this.disposed = true;
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private applyUniforms(): void {
    const current = this.currentAppearance;
    this.material.uniforms.uDeepColor.value.copy(current.deepColor);
    this.material.uniforms.uShallowColor.value.copy(current.shallowColor);
    this.material.uniforms.uSpeckColor.value.copy(current.speckColor);
    this.material.uniforms.uVerticalTone.value = current.verticalTone;
    this.material.uniforms.uGrainScale.value = current.grainScale;
    this.material.uniforms.uEdgeDarkening.value = current.edgeDarkening;
  }
}

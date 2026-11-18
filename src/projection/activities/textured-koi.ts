import * as THREE from "three";
import { MAX_FISH, CANVAS_WIDTH, CANVAS_HEIGHT } from "../../config";
import { POND_BOUNDARY_GLSL } from "./pond-boundary";
import type { School } from "../../school";
import { swimmingSection } from "./swim-motion";

const ROWS = 32;
const COLS = 6;
const vertexShader = `varying vec2 vUv; varying vec2 vWorld; void main(){vUv=uv;vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xy;gl_Position=projectionMatrix*viewMatrix*world;}`;
const fragmentShader = `precision highp float; uniform sampler2D uMap; uniform float uDepth; uniform float uShadow; uniform vec3 uTint; uniform vec2 uResolution; varying vec2 vUv; varying vec2 vWorld;
${POND_BOUNDARY_GLSL}
void main(){ vec4 tex=texture2D(uMap,vUv);float bankDistance=pondWaterDistance(vWorld/uResolution,uResolution);tex.a*=smoothstep(0.0,3.0,bankDistance);if(tex.a<0.015)discard;
vec3 wet=tex.rgb*uTint; float center=pow(max(0.0,1.0-abs(vUv.x-.5)*2.0),3.0);
wet+=vec3(.024,.028,.022)*center*(1.0-uDepth);
wet=mix(wet,wet*vec3(.64,.78,.71),uDepth*.44);
if(uShadow>.5) gl_FragColor=vec4(.018,.055,.044,tex.a*(.19+.11*uDepth));
else gl_FragColor=vec4(wet,tex.a); }`;

export class TexturedKoiPass {
  readonly group = new THREE.Group();
  readonly shadowGroup = new THREE.Group();
  private textures: THREE.Texture[] = [];
  private loaded = 0;
  private disposed = false;
  assetError = "";
  private meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private shadows: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] =
    [];
  get ready(): boolean {
    return this.loaded === 2;
  }
  constructor() {
    const loader = new THREE.TextureLoader();
    ["koi-kohaku.png", "koi-showa.png"].forEach((name, index) => {
      const tex = loader.load(
        `${import.meta.env.BASE_URL}assets/${name}`,
        (texture) => {
          if (this.disposed) {
            texture.dispose();
            return;
          }
          this.loaded++;
        },
        undefined,
        () => {
          if (!this.disposed)
            this.assetError = `Could not load koi artwork: ${name}`;
        },
      );
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = 4;
      this.textures[index] = tex;
    });
    for (let index = 0; index < MAX_FISH; index++) {
      const geometry = new THREE.PlaneGeometry(1, 1, COLS, ROWS);
      const positions = geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      positions.setUsage(THREE.DynamicDrawUsage);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uMap: { value: this.textures[index % 2] },
          uResolution: {
            value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT),
          },
          uDepth: { value: 0 },
          uShadow: { value: 0 },
          uTint: {
            value: new THREE.Color().setRGB(
              1,
              0.98 + (index % 3) * 0.01,
              0.96 + (index % 4) * 0.01,
            ),
          },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = index;
      const shadowMaterial = material.clone();
      // Share the source texture: UniformsUtils clones textures, which otherwise
      // introduces hidden duplicate uploads and an independently stale version.
      const clonedMap = shadowMaterial.uniforms.uMap.value as THREE.Texture;
      if (clonedMap !== this.textures[index % 2]) clonedMap.dispose();
      shadowMaterial.uniforms.uMap.value = this.textures[index % 2];
      shadowMaterial.uniforms.uShadow.value = 1;
      const shadow = new THREE.Mesh(geometry, shadowMaterial);
      shadow.frustumCulled = false;
      shadow.renderOrder = index;
      this.meshes.push(mesh);
      this.shadows.push(shadow);
      this.group.add(mesh);
      this.shadowGroup.add(shadow);
    }
  }
  update(school: School) {
    this.group.visible = this.ready;
    this.shadowGroup.visible = this.ready;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i],
        shadow = this.shadows[i],
        fish = school.fish[i];
      mesh.visible = shadow.visible = i < school.count;
      if (i >= school.count) continue;
      const positions = mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let row = 0; row <= ROWS; row++) {
        const section = swimmingSection(fish, row / ROWS, i);
        for (let col = 0; col <= COLS; col++) {
          const across = col / COLS - 0.5;
          const offset = across * section.width + section.finFlutter * across;
          positions.setXYZ(
            row * (COLS + 1) + col,
            section.center.x + section.normal.x * offset,
            section.center.y + section.normal.y * offset,
            0,
          );
        }
      }
      positions.needsUpdate = true;
      mesh.material.uniforms.uResolution.value.set(CANVAS_WIDTH, CANVAS_HEIGHT);
      shadow.material.uniforms.uResolution.value.set(
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
      mesh.material.uniforms.uDepth.value = fish.depth;
      shadow.material.uniforms.uDepth.value = fish.depth;
      shadow.position.set(5 + fish.depth * 6, 7 + fish.depth * 10, 0);
    }
  }
  dispose() {
    this.disposed = true;
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].geometry.dispose();
      this.meshes[i].material.dispose();
      this.shadows[i].material.dispose();
    }
    this.textures.forEach((t) => t.dispose());
    this.group.clear();
    this.shadowGroup.clear();
  }
}

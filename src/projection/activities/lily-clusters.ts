import * as THREE from "three";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../../config";
const vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `precision highp float;uniform sampler2D uMap;uniform float uShadow;varying vec2 vUv;void main(){vec4 c=texture2D(uMap,vUv);if(c.a<.02)discard;gl_FragColor=uShadow>.5?vec4(.015,.035,.023,c.a*.3):c;}`;
export class LilyClusterPass {
  readonly group = new THREE.Group();
  readonly shadowGroup = new THREE.Group();
  private texture: THREE.Texture;
  private disposed = false;
  private loaded = false;
  assetError = "";
  private leaves: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private shadows: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private placements = [
    { x: 0.19, y: 0.2, size: 112, angle: -0.28 },
    { x: 0.82, y: 0.24, size: 128, angle: 0.4 },
    { x: 0.83, y: 0.76, size: 104, angle: 2.2 },
  ];
  get ready() {
    return this.loaded;
  }
  constructor() {
    this.group.visible = this.shadowGroup.visible = false;
    this.texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}assets/lily-cluster.png`,
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        this.loaded = true;
        this.group.visible = this.shadowGroup.visible = true;
        const image = tex.image as HTMLImageElement;
        const aspect = image.width / image.height;
        this.placements.forEach((p, i) => {
          this.leaves[i].scale.set(p.size, p.size / aspect, 1);
          this.shadows[i].scale.copy(this.leaves[i].scale);
        });
      },
      undefined,
      () => {
        if (!this.disposed) this.assetError = "Could not load lily artwork.";
      },
    );
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 4;
    this.placements.forEach((p, i) => {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const makeMaterial = (shadow: number) =>
        new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: {
            uMap: { value: this.texture },
            uShadow: { value: shadow },
          },
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
      const leaf = new THREE.Mesh(geometry, makeMaterial(0)),
        shadow = new THREE.Mesh(geometry, makeMaterial(1));
      leaf.renderOrder = 10 + i;
      shadow.renderOrder = 10 + i;
      leaf.frustumCulled = shadow.frustumCulled = false;
      leaf.scale.set(p.size, p.size, 1);
      shadow.scale.copy(leaf.scale);
      this.leaves.push(leaf);
      this.shadows.push(shadow);
      this.group.add(leaf);
      this.shadowGroup.add(shadow);
    });
  }
  update(time: number) {
    this.placements.forEach((p, i) => {
      const x = CANVAS_WIDTH * p.x + Math.sin(time * 0.27 + i) * 1.6,
        y = CANVAS_HEIGHT * p.y + Math.cos(time * 0.21 + i) * 1.1;
      const leaf = this.leaves[i],
        shadow = this.shadows[i];
      leaf.position.set(x, y, 0);
      leaf.rotation.z = p.angle + Math.sin(time * 0.12 + i) * 0.015;
      shadow.position.set(x + 5, y + 9, 0);
      shadow.rotation.z = leaf.rotation.z;
    });
  }
  dispose() {
    this.disposed = true;
    this.texture.dispose();
    this.leaves.forEach((leaf, i) => {
      leaf.geometry.dispose();
      leaf.material.dispose();
      this.shadows[i].material.dispose();
    });
    this.group.clear();
    this.shadowGroup.clear();
  }
}

import * as THREE from "three";
import { SATURN_RING_RADIUS, type Planet } from "./astronomy-model";

export const PLANET_ASSETS = [
  "astronomy-earth-surface.jpg",
  "astronomy-earth-clouds.jpg",
  "astronomy-saturn.jpg",
  "astronomy-saturn-rings.png",
  "astronomy-moon-surface.jpg",
  "astronomy-moon-height.jpg",
] as const;
const SUN = new THREE.Vector3(-0.42, 0.5, 0.76).normalize();
const vertex = `varying vec2 vUv;varying vec3 vNormal;varying vec3 vLocal;varying vec3 vView;
void main(){vUv=uv;vLocal=position;vNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.0);vView=vec3(0.0,0.0,1.0);gl_Position=projectionMatrix*p;}`;
const lighting = `varying vec2 vUv;varying vec3 vNormal;varying vec3 vLocal;varying vec3 vView;
const vec3 sun=normalize(vec3(-.42,.50,.76));
float daylight(vec3 n){return max(0.0,dot(n,sun));}`;
const earthFragment = `${lighting}
uniform sampler2D uSurface;uniform sampler2D uClouds;uniform float uCloudShift;
void main(){vec3 n=normalize(vNormal),view=normalize(vView);float lit=daylight(n);
 vec3 albedo=texture2D(uSurface,vUv).rgb;
 float cloudShadow=pow(texture2D(uClouds,vUv+vec2(-uCloudShift+.002,-.002)).r,1.7);
 vec3 color=albedo*(.022+lit*1.32)*(1.0-cloudShadow*.36*smoothstep(0.0,.25,lit));
 float ocean=smoothstep(.015,.12,albedo.b-max(albedo.r,albedo.g*.8));
 float specular=pow(max(0.0,dot(reflect(-sun,n),view)),75.0)*ocean*.32*(1.0-cloudShadow);
 color+=vec3(.78,.86,1.0)*specular;
 float limb=pow(1.0-max(0.0,dot(n,view)),3.5);
 color+=vec3(.025,.13,.30)*limb*smoothstep(-.12,.35,dot(n,sun))*.35;
 gl_FragColor=vec4(color,1.0);
 #include <colorspace_fragment>
}`;
const cloudFragment = `${lighting}
uniform sampler2D uClouds;
void main(){vec3 n=normalize(vNormal);float coverage=pow(texture2D(uClouds,vUv).r,1.55);
 float lit=daylight(n);vec3 color=vec3(.91,.96,1.0)*(.035+lit*1.32);
 gl_FragColor=vec4(color,coverage*.90);
 #include <colorspace_fragment>
}`;
const atmosphereFragment = `${lighting}
void main(){vec3 n=normalize(vNormal);float rim=pow(1.0-max(0.0,dot(n,normalize(vView))),3.2);
 float lit=smoothstep(-.18,.40,dot(n,sun));
 gl_FragColor=vec4(vec3(.14,.40,.85),rim*lit*.32);
 #include <colorspace_fragment>
}`;
const saturnFragment = `${lighting}
uniform sampler2D uSurface;uniform sampler2D uRings;uniform vec3 uSunLocal;
void main(){vec3 n=normalize(vNormal),point=vLocal*vec3(1.0,.902,1.0);float lit=daylight(n);
 float t=-point.y/uSunLocal.y;float shadow=0.0;
 if(t>0.0){vec3 hit=point+uSunLocal*t;float r=length(hit.xz);
  if(r>1.11&&r<${SATURN_RING_RADIUS.toFixed(2)})shadow=texture2D(uRings,vec2((r-1.11)/${(SATURN_RING_RADIUS - 1.11).toFixed(2)},.5)).a*.72;}
 vec3 albedo=texture2D(uSurface,vUv).rgb;
 vec3 color=albedo*(.026+lit*1.28*(1.0-shadow));
 float haze=pow(1.0-max(0.0,dot(n,normalize(vView))),4.0)*smoothstep(-.12,.45,dot(n,sun));
 color=mix(color,vec3(.64,.57,.43),haze*.08);
 gl_FragColor=vec4(color,1.0);
 #include <colorspace_fragment>
}`;
const ringVertex = `varying vec3 vLocal;void main(){vLocal=vec3(position.x,0.0,position.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const ringFragment = `varying vec3 vLocal;uniform sampler2D uRings;uniform vec3 uSunLocal;
void main(){float r=length(vLocal.xz);vec4 ring=texture2D(uRings,vec2((r-1.11)/${(SATURN_RING_RADIUS - 1.11).toFixed(2)},.5));
 // The planet occults the sunlight along a forward ray, rather than a painted dark stripe.
 vec3 p=vLocal/vec3(1.0,.902,1.0),l=normalize(uSunLocal/vec3(1.0,.902,1.0));
 float travel=max(0.0,-dot(p,l));float distance=length(p+l*travel);
 float shadow=(1.0-smoothstep(.985,1.025,distance))*step(.001,travel);
 float incidence=.38+.62*abs(uSunLocal.y);
 vec3 color=ring.rgb*(.028+incidence*(1.0-shadow*.94));
 gl_FragColor=vec4(color,ring.a);
 #include <colorspace_fragment>
}`;

/** Source-backed surface maps and coupled planet/ring lighting. */
export function createPlanetSystems(
  scene: THREE.Scene,
  geometry: THREE.SphereGeometry,
  planets: readonly Planet[],
  texture: (name: string, data?: boolean) => THREE.Texture,
) {
  const earth = texture(PLANET_ASSETS[0]),
    clouds = texture(PLANET_ASSETS[1], true);
  const saturn = texture(PLANET_ASSETS[2]),
    rings = texture(PLANET_ASSETS[3]);
  const moon = texture(PLANET_ASSETS[4]),
    height = texture(PLANET_ASSETS[5], true);
  earth.wrapS =
    clouds.wrapS =
    saturn.wrapS =
    moon.wrapS =
    height.wrapS =
      THREE.RepeatWrapping;
  const nodes = planets.map((planet) => {
    const group = new THREE.Group();
    scene.add(group);
    const uniforms = {
      uSurface: { value: planet.kind === "earth" ? earth : saturn },
      uClouds: { value: clouds },
      uCloudShift: { value: 0 },
      uRings: { value: rings },
      uSunLocal: { value: SUN.clone() },
    };
    const material =
      planet.kind === "moon"
        ? new THREE.MeshStandardMaterial({
            map: moon,
            color: 0xbcbcc1,
            bumpMap: height,
            bumpScale: planet.radius * 0.008,
            roughness: 1,
            metalness: 0,
          })
        : new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader:
              planet.kind === "earth" ? earthFragment : saturnFragment,
            uniforms,
            toneMapped: false,
          });
    const body = new THREE.Mesh(geometry, material);
    body.scale.set(
      planet.radius,
      planet.radius * (planet.kind === "saturn" ? 0.902 : 1),
      planet.radius,
    );
    group.add(body);
    let cloudMesh:
      THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (planet.kind === "earth") {
      group.rotation.z = 0.22;
      cloudMesh = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: cloudFragment,
          uniforms: { uClouds: { value: clouds } },
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      cloudMesh.scale.setScalar(planet.radius * 1.004);
      group.add(cloudMesh);
      const air = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: atmosphereFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      air.scale.setScalar(planet.radius * 1.015);
      group.add(air);
    }
    let ringUniform: THREE.IUniform<THREE.Vector3> | undefined;
    if (planet.kind === "saturn") {
      // One shared axial tilt keeps atmospheric bands, oblate shape and rings coplanar.
      group.rotation.set(0.48, 0, -0.35);
      ringUniform = { value: SUN.clone() };
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.11, SATURN_RING_RADIUS, 256),
        new THREE.ShaderMaterial({
          vertexShader: ringVertex,
          fragmentShader: ringFragment,
          uniforms: { uRings: { value: rings }, uSunLocal: ringUniform },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      // RingGeometry is XY; the equatorial ring plane is XZ.
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(planet.radius);
      group.add(ring);
    }
    return { group, body, cloudMesh, uniforms, ringUniform };
  });
  const localSun = new THREE.Vector3(),
    inverse = new THREE.Quaternion();
  return {
    update(aspect: number) {
      planets.forEach((planet, i) => {
        const node = nodes[i];
        node.group.position.set(planet.x, (1 - planet.y) * aspect, 0.05);
        const spin =
          planet.spin +
          (planet.kind === "earth"
            ? 2.8
            : planet.kind === "moon"
              ? -Math.PI / 2
              : 0.5);
        node.body.rotation.y = spin;
        if (node.cloudMesh) {
          node.cloudMesh.rotation.y = spin + 0.045 + planet.spin * 0.025;
          node.uniforms.uCloudShift.value =
            (0.045 + planet.spin * 0.025) / (Math.PI * 2);
        }
        if (node.ringUniform) {
          localSun
            .copy(SUN)
            .applyQuaternion(inverse.copy(node.group.quaternion).invert());
          node.ringUniform.value.copy(localSun);
          node.uniforms.uSunLocal.value
            .copy(localSun)
            .applyQuaternion(inverse.copy(node.body.quaternion).invert());
        }
      });
    },
  };
}

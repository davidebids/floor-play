# Astronomy scene assets

Prepared 2026-11-17. These are local runtime assets; the application makes no external image requests.

| Runtime asset | Dimensions | Bytes | Source |
| --- | --- | --- | --- |
| `public/assets/scenes/astronomy-nebula.png` | 1536 × 1024 | 2,372,865 | Built-in OpenAI image generation tool; original output `exec-b3bba73c-f40f-4f7e-87be-c68aef3acdbc.png` |
| `public/assets/scenes/astronomy-earth.jpg` | 2048 × 1024 | 512,606 | [Official three.js example Earth texture](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg) |
| `public/assets/scenes/astronomy-moon.jpg` | 1024 × 512 | 238,093 | [Official three.js example Moon texture](https://threejs.org/examples/textures/planets/moon_1024.jpg) |

The two planet texture filenames were verified in the [official three.js repository](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets), downloaded unchanged, and visually inspected as correct equirectangular maps. No image-processing package, API key or paid CLI fallback was used. The generated nebula is an imagined astronomical composition, not a photograph or scientifically identified star chart. Live planets and interaction feedback are rendered separately.

## Exact nebula prompt

Use case: photorealistic-natural. Asset type: production background texture for a beautiful astronomy floor-projection scene. Create a landscape 3:2, high resolution astrophotographic deep-space nebula vista. Richly layered indigo, deep violet, muted magenta and luminous teal nebula filaments with authentic fine gaseous tendrils and dark dust lanes, concentrated mostly toward the perimeter and especially the upper-left and lower-right corners. Countless but delicately sparse tiny realistic distant stars of different brightnesses. The central 60 percent must remain relatively open and dark navy with subtle nebulosity, giving room for separately rendered moving 3D planets. Beautiful dimensional astronomical imaging rather than a painted illustration. Medium-bright detailed colored clouds should remain legible projected in a dim room; avoid a nearly black or washed-out picture. Natural soft light, restrained highlights. Fill the frame completely. No planets, moons, sun, spacecraft, horizons, people, giant starbursts, lens flares, text, labels, borders, diagrams, logos or watermarks.

## Generation record

Built-in tool mode, new image, opaque background. Original generated output: `/Users/debidia/.codex/generated_images/01a1ecd3-61e0-74f3-ad8c-46cda31ec374/exec-b3bba73c-f40f-4f7e-87be-c68aef3acdbc.png`. The production copy preserves all original pixels. Visual inspection confirmed no baked-in planets, labels, horizons or giant lens flares, with bright edge filaments and ample central room for the live scene.

## SHA-256

```text
66b54e28396d2a2d811b56a06dbee57cfde1fa597f240a3a7d1633cf5e3bb356  astronomy-nebula.png
2faa400d1eade3bc44caf6750d1b772bd9bbb6d87362c02bc7c3304e78fa0a9d  astronomy-earth.jpg
fcb0f1f5548e6e18d40063dd55c6aacd3daedf2407b181dab85b61e22bf9fe57  astronomy-moon.jpg
```


## Planet realism texture pass — 2026-11-17

These six additional source images are downloaded unchanged and total2,210,292bytes (approximately2.21MB). None are generated textures. Existing first-pass Earth/Moon maps are retained as earlier source assets. All new images were visually inspected before integration.

| Runtime asset | Dimensions | Bytes | Direct original source |
| --- | --- | --- | --- |
| `public/assets/scenes/astronomy-earth-surface.jpg` | 2048×1024 | 463,087 | [Solar System Scope Earth day map](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) |
| `public/assets/scenes/astronomy-earth-clouds.jpg` | 2048×1024 | 965,676 | [Solar System Scope Earth clouds](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg) |
| `public/assets/scenes/astronomy-saturn.jpg` | 2048×1024 | 199,916 | [Solar System Scope Saturn](https://www.solarsystemscope.com/textures/download/2k_saturn.jpg) |
| `public/assets/scenes/astronomy-saturn-rings.png` | 2048×125 RGBA | 12,119 | [Solar System Scope Saturn ring alpha](https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png) |
| `public/assets/scenes/astronomy-moon-surface.jpg` | 2048×1024 | 457,942 | [NASA SVS LROC 2025 lunar color map](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg) |
| `public/assets/scenes/astronomy-moon-height.jpg` | 1024×512 | 111,552 | [NASA SVS LOLA lunar elevation preview](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg) |

### Credit and interpretation

The four Solar System Scope maps are by Solar System Scope/INOVE, credited under [CC-BY4.0](https://creativecommons.org/licenses/by/4.0/), with originals and source description on the [creator's texture page](https://www.solarsystemscope.com/textures/). The creator describes these equirectangular textures as based on NASA imagery/elevation data, with colors adjusted to true-color spacecraft photography and some saturation adjustment. They are rendering maps, not untouched instrument measurements.

The two lunar maps come directly from [NASA Scientific Visualization Studio's CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), visualization by Ernie Wright using Lunar Reconnaissance Orbiter Camera and Lunar Orbiter Laser Altimeter data. NASA describes the color map as optimized for aesthetics rather than scientific measurement. Color and elevation maps are centered on0°longitude and intended for3Drendering.

### Mapping notes

- Earth surface is cloud-free, allowing a separately lit/elevated cloud shell. The cloud JPEG is grayscale: use its brightness as coverage/alpha; its JPEG alpha is implicitly1.
- Saturn's surface has subtle irregular cloud bands and polar variation, rather than repeated synthetic stripes.
- The ring strip's **horizontalUaxis is radial**, from inner edge atU0 to outer edge atU1; sampleV=.5. The PNG contains real alpha. Midrow samples atU0/.05 have alpha0, U.1≈46, U.5≈241, U.75≈210, U.99≈13; gaps and fine radial structure are baked into the profile. Preserve alpha and sRGB color separately.
- Moon color is sRGB; the LOLA elevation preview is linear data and should not be sRGB-decoded when used for bump/displacement. Elevation is a low-bandwidth visual derivative, not an accurate geometric terrain model at this resolution.
- No image pixels were retouched, recolored, resized or converted. System Python's TLS could not negotiate the NASA connection, so the NASA files were fetched with the normal system curl HTTPS client; certificate verification was not bypassed.

### Realism-pass SHA-256

```text
767ee1dc6eb3802699bfccf6f264880f8acd0b80de3191cd24984fe279b07b7c  astronomy-earth-surface.jpg
fffd7f68d41b37274822150e54a6ef605af1d3ec35624d9f628c3b896bfa42ed  astronomy-earth-clouds.jpg
54a900ca9bf7ab62e70f862852759abdf342e6d6436a95a2fe9ebdb6bcd3bbac  astronomy-saturn.jpg
4b0644b2f3ef259fd0bfaedd9dc52f9e7d9738f65f50363e8c4dd19f650d7334  astronomy-saturn-rings.png
f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170  astronomy-moon-surface.jpg
6d93f887e7d8bedfe35ab89ba785e5e3ca12381bd092a5e6abe2c707dda8bb98  astronomy-moon-height.jpg
```

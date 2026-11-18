# Generated assets and runtime sources

The initial four koi raster assets were generated with the built-in OpenAI imagegen tool under the imagegen skill on2026-11-13. Project copies preserve the original alpha channels for fish and lilies. They are consumed by live rendering, rather than being a static picture of the complete experience.

| Runtime file | Generation output ID | Role |
|---|---|---|
| public/assets/pond-bed.png | exec-366c9ee8-deb4-4185-9e1d-ba9d48b6c4ec | Photographic dry basin/bank/stone texture; water and lighting added at runtime |
| public/assets/koi-kohaku.png | exec-32ce220e-6e77-43ee-87db-3f459b157260 | Transparent Kohaku koi, deformed by the live swimming mesh |
| public/assets/koi-showa.png | exec-e97e3b25-fdbf-4ad2-8ead-d059c5fc57b5 | Transparent Showa koi, deformed by the live swimming mesh |
| public/assets/lily-cluster.png | exec-bda0501b-906f-4e6b-a29b-5e3c486c93ef | Transparent botanical cluster, floating with submerged shadow |

## Prompt set

### Pond bed
Use case photorealistic-natural. Production game environment texture for a top-down floor-projected realistic koi pond, landscape3:2. Empty dry pond bed/bank, no fish/water/reflections/caustics/tree shadows/text. Absolutely straight overhead/orthographic. Organic rounded rectangular basin occupying85%ofimage; natural fine river gravel, pale sand, occasional smooth stones; irregular charcoal/slate and warm grey perimeter boulders, moss crevices and restrained corner ferns. Open but detailed central play area; bright muted olive-grey/tan pebbles. Flat diffuse neutral daylight because runtime supplies lighting/water. Fill frame, no margin or vignette.

### Koi (two separate generations)
Production transparent fish texture for dynamically deformed mesh. Camera vertically over back, zero perspective; headTOP/tailBOTTOM, centered straight neutral symmetric pose, full body/allfins/tail with5%margin. Anatomically accurate mature koi with rounded broad head, lateral eyes, tapered muscular body, fine overlapping scales, restrained pearlescent sheen, translucent pectoral/pelvic fins and forked tail. Soft diffuse overhead illumination, dimensional body shading; no cast shadow/environment/water/bubbles/ripples/text/otherfish. Actual transparent background between fins.

Kohaku subject: luminous ivory-white skin with irregular deep vermilion-red patches over head/back and no black patches. Showa subject: ivory-white skin with irregular jet-black and rich orange-red markings.

### Lily cluster
Transparent overhead realistic koi-pond texture: three water-lily leaves and one delicate ivory flower with pale golden center. Straight overhead/zero perspective, full arrangement with transparent background. Rounded heart-shaped leaves with radial notch, rich fine veins, natural muted green with slight weathering and tiny droplets, delicate uneven edges, soft dimensional shading. Two larger leaves and one smaller leaf, flower to one side, organic overlap. Diffuse daylight; no water/ground/extendedstem/castshadow/fish/text/border.

## Other local sources

Nagomi simulation and render foundation: upstream git history and LICENSE retained. Tracking models are the official MediaPipe selfie_segmenter_landscape and hand_landmarker downloads from storage.googleapis.com/mediapipe-models, stored under public/models. MediaPipe WASM loaders/binaries are copied from the installed pinned @mediapipe/tasks-vision0.10.32 package into public/wasm. Inter font is bundled from @fontsource-variable/inter. Recorded audio assets are bundled locally with source records and credits; WebAudio handles playback and mixing.

No Tripo/Gemini/ElevenLabs credentials were configured; no paid fallback API was used.


## Four additional scenes

Seven new production raster assets were generated using the built-in image generation tool and copied into the project with their alpha intact. No generation API key or fallback CLI was used. Exact prompt sets and original generated-file paths are recorded in [forest/meadow generation notes](../artifacts/new-scenes-forest-assets.md) and [shore generation notes](../artifacts/new-scenes-shore-assets.md).

| Saved project asset | Use |
| --- | --- |
| public/assets/scenes/forest-floor.png | Photographic moss/woodland stage |
| public/assets/scenes/woodland-leaf.png | Transparent maple leaf, dynamically moved and lifted |
| public/assets/scenes/butterfly-meadow.png | Photographic meadow stage |
| public/assets/scenes/meadow-butterfly.png | Transparent butterfly, deforming wings and banking flight |
| public/assets/scenes/tide-pool.png | Photographic shallow tide pool |
| public/assets/scenes/shore-crab.png | Transparent shore crab with scuttling leg deformation |
| public/assets/scenes/sandy-beach.png | Photographic sand stage with live waves and touch marks |

Backgrounds are 1536 × 1024; the three cutouts are 1254 × 1254. Live animation, shadows, water, sand marks and responsive objects are rendered separately from the backgrounds.

## Recorded audio

The former synthesized noise was replaced with twenty local MP3 assets: five recorded ambience beds and separate pond-plop, tide-touch, leaf-rustle, butterfly-wing and dry-sand interaction pools. [Audio sources and processing](../public/assets/audio/README.md), [source records](../public/assets/audio/sources.json), and [loudness/hash measurements](../public/assets/audio/analysis.json) are stored with the assets. Provider credentials were unavailable; actual recorded sources were used rather than another noise-synthesis fallback.

# Local implementation handoff — 2026-11-13

The app is implemented in `/Users/debidia/Documents/Playground/projection-app`. Start with `npm run dev`, then open http://127.0.0.1:5188/ in Chrome. The preview server was left running for review. No deployment or upstream push was performed.

## Delivered

- Parent controls and a separate, synchronized projector window with fullscreen, pause, blank, sound, fish count/pace, and camera status.
- A complete pond composition: generated stone/pebble bed, bank vegetation, photographic koi textures, lilies, dynamic water, refraction, caustics, shadows and splash/ripple effects. Provenance and image-generation details are in ../docs/ASSETS.md.
- Camera selection and recovery, local person/hand inference, floor mapping, motion avoidance, approximate hand-strike impulses and safeguards against stale or repeated input.
- Four-corner camera/output calibration, editable output warp, floor dimensions, calibration invalidation after relevant setup changes, saved setup and import/export.
- Shared presence/motion/impulse contracts, lazy activity lifecycle/registry and per-activity settings. Five activities are implemented: koi pond, forest floor, tide pool, butterfly meadow and sandy beach. They share the input/calibration layer.
- Local assets/models/WASM, no telemetry and no default camera recording.

## Fish movement revision

The feedback pass replaces frequent stop-and-pivot motion with longer glides, moving coasts and broad speed-dependent turns. Fish bodies follow a distance-sampled head trajectory, with stronger motion toward the tail and tail strokes tied to speed. Anticipatory bank steering replaces hard position clamps.

`qa/movement-v2.webm` and its four frame captures were visually reviewed. In 40 observations of eight fish, the sample had zero stopped observations or browser errors, minimum observed speed 14.52 logical pixels/s and maximum yaw 0.358 radians/s. Each fish travelled 0.47–0.66 m in the recorded sequence. This is evidence for that sample, not a guarantee of all possible swimming paths.

## Validation

| Check | Result |
| --- | --- |
| Automated tests | 202 passed across 23 files |
| Browser tests | 23 passed, 0 skipped, 0 unexpected, 0 flaky |
| TypeScript and production build | Passed |
| Formatting and diff whitespace | Passed |
| Visual evidence verifier | Passed; declared captures/assets confirmed |
| Production browser smoke | No page/console errors or external requests; synthetic camera calibration works; development hooks absent |
| Actual GoPro | HERO10 Black live at 1280 × 720, local models loaded, seven inference frames; stop releases video and clears input |
| Target layouts | Desktop 1440 × 1000, laptop 1024 × 768, projector 1280 × 720; narrow 390 × 844 layout capture |

Camera evidence is in `camera-smoke.json`, `vision-worker-smoke.json` and `vision-integration.md`. The real-camera test used an identity calibration to verify software gating, not physical floor alignment. The production smoke used a synthetic camera and must not be interpreted as another real-camera test. No actual camera imagery was recorded.

Current canvas evidence: Apple M4 Pro hardware GPU and 60 measured render fps. Idle: 38 draw calls, 6,164 triangles and 25 geometries; active splash: 40 draw calls, about 6,700 triangles and 27 geometries. Both use seven textures. The inspector reports entropy 6.46 bits, edge density 0.832, luminance contrast 110.3 and dominant-color share 0.096. Configured desktop render budgets passed. These are short browser samples, not a long-duration soak or projector latency measurement. Full captures: `qa/control-desktop.png`, `qa/control-laptop.png`, `qa/control-narrow.png`, `qa/projector-active.png`; motion: `qa/pond-motion.webm`.

The production build warns about a shared 3D/audio dependency chunk (537 kB minified / 134 kB gzip); individual scene modules are lazy loaded. All content is local. Node 25 ran successfully but is outside Vitest's supported engine range; Node 24 LTS is recommended.

## Visual assessment

Genre equivalents: hero = koi; obstacles = pond banks and floor boundary; interactables = hand/motion ripples and splashes. Packaged visual anchors were inspected. No before baseline was captured, so before scores are not available. Provisional current scores on the 0–3 skill rubric:

| Category | Before | Current | Evidence / limit |
| --- | --- | --- | --- |
| Art direction | Not captured | 2 | Coherent natural pond and quiet parent controls |
| Hero / koi | Not captured | 2 | Authored photographic silhouette and deforming swim; only two texture variants |
| Obstacles / banks | Not captured | 2 | Readable textured shore and anticipatory avoidance |
| Interactables | Not captured | 2 | Localized impulse ripples and splash feedback |
| World / environment | Not captured | 2 | Stone bed, bank, vegetation and lily layers |
| Materials / textures | Not captured | 2 | Generated natural textures, alpha fish/lilies and water shading |
| Lighting / render | Not captured | 2 | Caustics/refraction/shadows; actual projected contrast untested |
| VFX / motion | Not captured | 2 | Event-driven water and revised continuous swimming |
| UI / HUD | Not captured | 2 | Parent controls separated from unobstructed projector output |
| Performance evidence | Not captured | 2 | Hardware metrics, browser checks, screenshots and short recordings |

Average 2.0/3. This does not claim the rubric's premium/showcase thresholds or the user's final visual acceptance. Further realism work should follow the live projected view, especially fish deformation and apparent water depth.


## Functional gap closure

The follow-up audit is recorded in [functional-gap-audit.md](functional-gap-audit.md). Fish are constrained to a conservative interior of the visible water with full fin/tail clearance, including immediate resizing. Fish and shadows have a defensive bank clip; soft pond optics remain intact. Dry-bank motion/impulses do not spawn water effects. Fifteen focused graphics tests cover six stress configurations and full-mesh safety across resizing.

Camera stop/stall clears stale previews; settings changes invalidate in-flight observations; stationary hands and foreground fallback require re-arming before another large impulse. There are now 27 focused vision tests. Calibration requires a live advancing feed and is tied to actual output geometry. Saved projector profiles survive control-window resizing/reloading and projector close/reopen; output movement invalidates them. Synthetic-camera browser tests verify single ownership and handback. Runtime failures and WebGL loss/recovery are tested both locally and through the projector controls.

The previous functional audit used run ID `functional-gaps-1`. All eight fish moved 0.20–0.30 m during the short interaction capture; `qa/functional-motion-summary.json` records the paths. The defensive shoreline guard still activates during some initial turns, so containment is not claimed to rely only on anticipatory steering. That audit captured 60 render fps on Apple M4 Pro, 39 draw calls, 26 geometries and seven textures, no page errors or external requests, no desktop/laptop overflow. Production smoke again passed with synthetic video and no exposed development hooks.

## Scene platform, splash and play-studio update

Floor Play is now a scene-neutral app. Definitions supply the scene title, description, thumbnail, interaction hint, controls and lazy loader. Sound belongs to each scene through optional activity audio hooks; the runtime no longer constructs water ambience. Five activities are now installed; the next section records the four new scenes. Existing v1 setup profiles remain compatible. See ../docs/SCENES.md.

The parent interface now uses a coherent midnight/apricot/mint play-studio theme: compact stage heading, larger scene view, thumbnail scene card, inspector controls and a transport dock. The native scene dropdown was replaced with a styled Base UI picker, including thumbnail/check states, keyboard navigation, Escape/focus restoration and protection from global playback shortcuts. The redundant privacy footer was removed as requested. Sliders retain thin tracks but now have 28px interaction areas; checkbox labels have 28px targets. A focused independent review found no clipping/overlap in the captured layouts. Desktop and laptop document overflow checks pass.

The pond splash now has a raised irregular crown, ballistic droplets, landing rings and gradual settling. Water refraction uses a continuous, damped slope so expanded ripples do not create sharp seams. Five focused tests cover trajectories, frame-rate independence, strength, bounded pools and disposal. Active effects return to zero after settling. Before/after motion: `qa/splash-before.webm`, `qa/splash-after.webm`; stages: `qa/splash-after-100.png`, `qa/splash-after-250.png`, `qa/splash-landing.png`, `qa/splash-settling.png`, `qa/splash-cleared.png`.

Output is no longer fixed at 960 × 640 pixels. Raster sizing uses display dimensions and density while keeping logical coordinates stable; the canvas and both image-compositing layers resize together. On this Mac the standalone HD check rendered at 1680 × 1120, Retina at 3240 × 2160, both measured at 60 fps; downsize restored smaller buffers without increasing geometry/texture counts. Allocation limits: 8,388,608 pixels, 4096 edge, 4× logical scale. The fullscreen preview also preserves floor proportions. Evidence: `qa/resolution-evidence.json`, `qa/projector-hd.png`, `qa/projector-retina.png`. Thirteen focused sizing tests and the browser fullscreen regression pass.

The play-studio checkpoint passed 163 automated tests across 19 files and 18 browser checks with no skipped, unexpected or flaky results; TypeScript/build, formatting, whitespace, local production smoke and evidence verification passed. Latest manifest run: `play-studio-1`; scene-picker captures include the user's 656px compact viewport. The production check uses synthetic camera video; real-camera hardware evidence remains separately identified above.

## Four new scenes, natural audio and performance

All four additional scenes are selectable in the existing scene picker, with generated photographic backgrounds, genuine transparent subject textures, live motion and separate saved settings:

| Scene | Interaction and animation | Recorded sound |
| --- | --- | --- |
| Forest floor | Leaves follow coherent gusts and hand wakes, tumble/lift on taps and settle to the ground | Woodland birds, breeze and soft leaf rustles |
| Tide pool | Crabs forage/rest and scuttle away laterally with moving legs; taps produce overlapping, damped refracting wave fronts | Rocky-shore ambience and gentle water contacts |
| Butterfly meadow | Butterflies blend wingbeats/glides, bank through curved turns, rest and lift away locally | Meadow breeze and actual butterfly-wing recordings |
| Sandy beach | Hands leave shallow textured depressions; incoming waves permanently erase marks at the waterline; peripheral crabs move naturally | Sandy surf and dry granular brush/pat variants |

Seven new PNGs are saved under `public/assets/scenes/`. Exact built-in generation prompts, original generated-image paths and saved project paths are linked from ../docs/ASSETS.md. Background plates are 1536 × 1024; cutouts 1254 × 1254. Runtime rendering remains display-density aware. Scene notes: ../docs/SCENES.md. The user-marked GoPro helper text has been removed.

The former synthesized hiss is gone. Twenty compact local MP3s provide five ambience beds and separate scene-specific tap pools. All voices route through shared volume/mute, stop on pause/blank/disposal, and use bounded polyphony/caching. Actual browser audio checks decoded every clip, measured nonzero ambience/effect signals and exactly zero paused signal, verified resume and a seamless prepared pond-loop overlap. Thirteen focused audio tests pass. Evidence: `audio-browser.json` and `../public/assets/audio/{README.md,sources.json,analysis.json}`. Subjective balance on the final speakers has not been assessed by the agent.

An independent audit found and closed two concrete defects: sound did not carry its prior unlock gesture into a newly loaded scene; and an obsolete delayed scene factory could create/dispose a second renderer on the active canvas, blanking the newer scene. New factories are guarded before construction, with an additional stale-result cleanup fallback. Browser regression deliberately delays one module while choosing another and verifies the final artwork pixels remain varied. A camera observation in flight is also invalidated across activity changes; alignment saving waits for a fresh live frame. Audit tests cover visible artwork, interactions, independent settings/reload, pause/blank/mute, old audio-context cleanup and projector handback.

Production performance was profiled on Apple M4 Pro / hardware Metal Chrome with repeated pointer movement/taps and high scene counts at 1280 × 720 DPR1 and 1920 × 1080 DPR2 (active rasters 1080 × 720 and 3240 × 2160). All ten cases held median 16.7 ms, p95/p99 at or below 16.8 ms, with no intervals above 25 or 50 ms and no browser errors in the 6.5-second active samples. Four nature scenes used about 0.19–0.31 ms script time per frame. The koi scene at 20 fish was CPU-bound in repeated path sampling: caching each swimming mesh cross-section once per row reduced script time from 12.95 to 3.34 ms/frame at normal density (74.2%) and 12.87 to 3.50 ms at Retina density (72.8%), preserving resolution and the tested mesh behavior. See `qa/performance-comparison.json`, the baseline/optimized reports and the raw CPU profile. These samples do not establish physical camera/projector latency, thermal endurance or every possible device/load.

Final integration: 202 automated tests across 23 files, 23 browser checks, TypeScript/build, formatting, whitespace, production smoke and visual-evidence checks passed. All four final active screenshots are under `qa/new-scenes/`, with an unpaused tour in `qa/new-scenes-tour.webm`. Forest/meadow before/after animation recordings and the independent audit artifacts are also retained. The latest visual manifest run is `five-scenes-1`.

## Physical checks still required

1. Position projector and camera over the 6 × 4 ft area; verify usable image size, operating orientation, brightness and shadows.
2. Align the four output corners and camera floor corners in the installed arrangement.
3. Check empty moving projection for false interactions, then crawling, chasing and near-floor hand strikes during toddler play; tune sensitivity and camera angle.
4. Judge actual action-to-image latency and fish/water appearance on the chosen floor or mat.
5. Check recovery after unplugging/reconnecting the camera and run a longer play session.

The desk-facing camera test detected no person or hands. Overhead toddler recognition and physical contact accuracy have not been established. Near-floor hover triggering is intentional and matches the accepted scope.

## Camera/projector setup closure — 2026-11-14

See [setup-flow-audit.md](setup-flow-audit.md) for the current setup audit. Alignment is bound to the actual live camera, its resolution/mirror state and the active output geometry; stale imported profiles and stale corner-marking sessions cannot silently re-enable mapping. Mirror changes reject queued old projector previews. Setup locks playback shortcuts in both windows, restores prior transport/grid state on cancel/control reload, and preserves exclusive capture across projector reload/close. Camera errors recover through camera controls, and floor-dimension drafts no longer collapse the live output while empty.

Current validation passed: 210 automated tests in 24 files, all 30 browser tests, TypeScript/production build, formatting/whitespace and built-app synthetic-camera smoke. Setup captures at desktop/compact/phone sizes and both alignment dialogs are in `qa/setup/`; `qa/setup/evidence.json` records no horizontal overflow or page errors. Actual HTML fullscreen and its parent heartbeat status were checked in visible Chrome because headless Chrome on this Mac rejects fullscreen in popup windows. No camera imagery was captured other than Chrome's synthetic test stream. The latest real-device enumeration did not find the GoPro; the final mounted hardware and projected floor interaction remain unverified.

## Live installed GoPro/projector tuning — 2026-11-14 follow-up

The user subsequently connected both devices and reported delayed/misplaced reactions. [live-hardware-tuning.md](live-hardware-tuning.md) records direct native-UI diagnosis of the actual HERO10 stream:447decodedframes but only1inference submission, despite60fps rendering. A bounded media-time polling fallback fixes suppressed compositor callbacks for hidden video. Live tracking recovered to12–14fps, with sampled27–33ms model processing; this is not an end-to-end latency measurement. Semantic hand landmarks now provide precise stationary presence, and the calibration preview is sharper.

Physical projection edges were inspected in the camera view and alignment was refined/saved for the final output arrangement. The user performed a hand sweep/hold/three-tap test and confirmed "Much better and follows my hand." The output was restored to the actual projector after a development refresh, final alignment saved again,65% sensitivity retained, diagnostics hidden, and play left running. No subsequent app-source changes were made. This supersedes the earlier missing-GoPro enumeration; toddler play and exhaustive tap accuracy remain separate from this adult hand acceptance.

Final follow-up checks passed:212automatedtests across24files,31browserchecks, TypeScript/production build, formatting/whitespace, and built-app synthetic-camera smoke. New regression coverage deliberately suppresses compositor callbacks and verifies continued bounded processing and clean stop. No raw camera videos or still frames were saved into the project.

## Tracking performance and missed-contact follow-up

[tracking-performance-audit.md](tracking-performance-audit.md) records the measured pass. Two optimized-build comparisons on the real GoPro improved completed analysis updates from12.50/s to28.50/s and28.19/s, with median model time falling28.7–28.8→23.0ms. Installed UI readings showed24–30trackingfps and60renderfps, with saved floor alignment and65% sensitivity retained. These are software pipeline measurements, not physical end-to-end latency or tracking accuracy scores.

GPU hand detection has tested CPU fallback, valid floor calibration focuses its image input, hand coordinates map back into the existing camera homography, motion energy stays consistent at higher sample rates, and fast entering-hand contacts require explicit temporal/semantic evidence. A controlled public-photo fixture retained both hand detections and bounded coordinate differences; the final physical hand/tap re-test remained unanswered at handoff. The old positive user feedback is not claimed as acceptance of these newer changes.

227 automated tests and32browser checks passed, including single ownership/recovery and a nonblank one-frame control preview after reload. Build/format/whitespace checks passed. Numeric reports and the source reproduction archive are under `qa/vision-performance/`. The running projector and native control UI were checked; no scene-resolution or artwork changes were made.

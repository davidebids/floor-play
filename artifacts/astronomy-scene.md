# Starlit cosmos — 2026-11-17

Added a sixth scene through the existing registry/lazy loader, without changing camera mapping, calibration, projector ownership or other scenes' settings and movement.

## Experience

- Generated photographic nebula, edge filaments and fine distant stars; all assets are local. Exact prompt/output, Earth/Moon texture source links and hashes are in [astronomy-assets.md](astronomy-assets.md).
- Lit rotating Earth and Moon, a shaded ringed gas planet with a ring division and self-occlusion, and a soft Earth atmosphere. The celestial arrangement is artistic, not a scale model or identified star chart.
- Hand/pointer presence parts nearby stars and gently nudges planets; they ease back toward their anchors.
- Each accepted tap creates a local starlight burst and a short shooting-star trail aimed inward, including at corners. Continuous presence does not manufacture taps.
- Independent Stars, Celestial drift and Starlight controls; optional soft pentatonic glass-note sonification, default muted. No ambient hiss or vacuum-sound effect.

## Bounded implementation

360 stars maximum;8 comet and8 starburst slots;608 effect points in a second batch. One background plane, three shared-geometry planet spheres, one cloud shell, one atmosphere shell and one ring. Updated planet realism records9draw calls with active feedback and60,994triangles. Renderer allocations use the shared resolution cap and integer logical height for arbitrary floor proportions. Disposal covers textures, geometry, materials and audio; failed artwork is recoverable through Reload scene.

An independent review found/fixed non-finite observation guards, fractional logical raster height and the full ring extent at bounds. Browser checks reproduced and fixed sound-toggle order (unlock precedes enabled-state configuration) and the first tap after quick pause/resume being swallowed by the previous note cooldown. Muting, pausing, blanking and zero volume immediately release notes and reset that cooldown.

## Verification

- 287 unit tests across31files passed;24new model/audio checks cover corner direction, local presence/taps, deduplication, finite bounds,30/60/120Hz consistency, anchor recovery, resource caps, gain routing, first-click unlock, voice limits, silence/recovery and disposal.
- TypeScript/production build, formatting and whitespace checks passed. Existing shared-chunk size advisory remains; no new dependency was added.
- Browser checks cover all six scenes, mapped-camera center/sides/corners, preferences,3.7ft floor proportions, projector handoff/pause, audio and failed-artwork recovery. The first full run had48passing checks plus2trace-file teardown failures caused by two test processes sharing an output directory. All3astronomy cases passed with isolated outputs. A clean full-suite rerun with a unique output directory passed all50checks in2.4minutes, with no skipped cases or retries.
- Production performance with360stars and repeated synthetic pointer actions: six-second samples at1280×720/DPR1 and1920×1080/DPR2,1.5-second warmup. Medians16.7ms; p95 16.7/16.8ms; no sampled frames over25ms, no runtime/console errors. Headless measurements are not physical sensor/projector latency or a thermal soak.
- Visual harness records unpaused sweeps/taps and desktop/compact captures under `qa/astronomy/`; idle/tap PNGs inspected. The harness uses no physical camera. Production smoke passed:64distinct sampled compositor colors, no runtime/console errors or external requests, and no development hook exposed. An initial raw WebGL pixel read returned a cleared buffer despite the correct screenshot; validation now reads decoded compositor pixels.

## Acceptance boundary

The actual Chrome app is open on Starlit cosmos with Mouse preview. The saved camera is currently unavailable; physical hand recognition, projector brightness/contrast and chime speaker balance in the installed setup remain unverified for this new scene. Existing nature-scene physical acceptance does not establish astronomy acceptance. No user camera imagery was recorded. Prepared for repository handoff; no hosted deployment.

Final verification:287unit tests/31files,50browser checks, production build, formatting/whitespace and production screenshot smoke passed. The new scene remains open locally.

## Planet realism follow-up

User requested more realistic planets. Replaced repeated synthetic Saturn bands/rings and flat Earth shading with six source-backed textures: cloud-free Earth and separate clouds, Saturn and radial alpha rings, NASA LROC Moon color and LOLA elevation. Added ocean highlights, cloud shadows and separate cloud rotation, a thinner sunlit atmosphere, oblate Saturn with a shared equatorial ring tilt, ring/planet shadow coupling and near-side lunar relief. The ring bound increases to2.27planet radii. Star/tap behavior and optional sound are retained.

Visual comparison: `qa/astronomy-realism/before.png` versus `qa/astronomy-realism/idle.png`. Source imagery and credit are in astronomy-assets.md. Independent review caught/fixed cloud-shadow drift sign and the orthographic view vector.287unit tests,8targeted browser checks, build and formatting pass. Browser checks include missing Moon/cloud/ring map recovery, preferences/projector handoff, chimes, camera center/sides/corners, all six scenes and Retina preview. Production profiling at360stars passed at both1280×720/DPR1 and1920×1080/DPR2:16.7ms median,16.7–16.8ms p95, no frames above25ms and no errors in the six-second samples. Final live Chrome screenshot confirmed updated planets at6×4ft with existing controls.

## Passive animation follow-up

Added gentle independent elliptical drift targets for the three planets, layered star drift, and occasional automatic shooting stars. Celestial drift controls their movement and cadence. Passive meteors start after3.5seconds and recur at calm intervals; they use a separate deterministic random stream, respect the same bounded comet pool, and yield to tap feedback. They create no starburst, input action, response counter or musical note. Turning drift to zero suppresses automatic meteors and returns positional motion toward rest. Shared simulation time freezes on pause/blank, so resume has no queued meteor catch-up.

290unit tests pass, including quiet-scene animation without fake taps, zero-drift idle behavior, skipped backlog and tap-priority capacity. Seven targeted browser checks pass, including hands-off motion with sound enabled but no notes, pause freezing, projector/preferences, recovery and all six scenes. Build/formatting/whitespace pass. A14-second hands-off recording under `qa/astronomy-passive/` had2ambient launches,0impulses,0responses,0audio voices and no errors; idle/shooting-star/drift captures were visually inspected. No physical camera was used.

Updated production profile with360stars and active synthetic input held16.7ms medians and16.7–16.8ms p95 at normal/Retina sizes; no sampled frame exceeded25ms and no errors occurred in the six-second samples. Temporary preview stopped; the main app remains running.

## Repository handoff validation

Final complete checks on the astronomy/realism/passive-motion source passed:290unit tests across31files,53Chrome browser checks with no skips or retries, production build, formatting and whitespace. The complete browser pass includes all six scenes, synthetic-camera center/edge/corner mapping, projector and calibration recovery, optional audio, texture recovery and passive-animation pause behavior. Physical projector/GoPro acceptance for the astronomy scene remains separate. Runtime art/source maps and written provenance are included; generated captures, videos, browser traces and builds remain local. No hosted deployment.

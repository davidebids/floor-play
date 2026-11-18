# Progress

## Current work
Astronomy repository handoff is validated:290unit tests,53full browser checks, production build, formatting and whitespace all pass. The scene, realistic planet assets, passive animation, tests and provenance are prepared together. QA recordings/builds remain local; no hosted deployment.

Passive cosmos animation is live: gentle planetary drift, layered star movement and silent periodic shooting stars, governed by Celestial drift and pause/blank.290unit tests and7targeted browser checks pass with build/formatting. A hands-off recording confirms ambient life without fake tap actions or sound; evidence is under qa/astronomy-passive.

Planet-realism follow-up adds photographic Saturn surface/rings, separated Earth surface/clouds with ocean highlights and thin atmosphere, and NASA Moon color/elevation with crater relief.287unit tests and8targeted browser checks pass with build/formatting; current visual evidence is under qa/astronomy-realism. The detailed planets remain at approximately60fps in both production profile sizes, without sampled frames over25ms.

Starlit cosmos is implemented and open as the sixth scene: generated nebula, textured lit Earth/Moon, a ringed gas planet, gently reactive stars and planets, inward shooting-star taps and optional tuned chimes. Shared camera/calibration/projector behavior is preserved. 287 unit tests,50browser checks, TypeScript/build, formatting/whitespace and production screenshot smoke pass. The production profile at 360 stars holds16.7ms median and16.7–16.8ms p95 at normal/Retina sizes, with no sampled frame above25ms. Browser regression and production smoke results are recorded in astronomy-scene.md. Physical astronomy projection acceptance remains untested; the installed UI currently uses Mouse preview with the saved camera unavailable.

## Prior scene/edge pass
Camera interaction testing now covers all five scenes and floor edges. Refined wet-shallows filtering, separate tap/motion feedback capacity, tide ripples, crab separation/pace, gentle forest tumbling/recovery, distinct butterfly takeoff and advancing/receding beach surf with four crabs. User physically accepted all five scenes after follow-up tuning, including bottom-left koi, gentler leaves/crabs, distinct butterfly taps and revised beach water/sand taps. 263 unit tests, 46 full browser checks and a focused meadow browser rerun passed, plus the seven scene/edge browser cases rerun after the final beach rendering change, production build, formatting/whitespace and synthetic-camera production smoke. Final live state: 60 render fps, 28.8 tracking updates/s, saved alignment intact; diagnostics hidden and Sandy beach playing. See scene-camera-coverage-audit.md for physical versus synthetic evidence and limits.


## Completed earlier scene pass
- Generated and integrated photographic forest, meadow, tide-pool and beach backgrounds plus transparent leaf, butterfly and shore-crab artwork. Exact prompts and original/project paths are in new-scenes-forest-assets.md and new-scenes-shore-assets.md.
- Added four selectable, interactive scenes with independent controls and preferences.
- Replaced synthetic hiss with recorded ambience for all five scenes and distinct water, leaf, real wing-flutter and dry-sand interaction pools. Twenty compact local MP3s, provenance and loudness measurements are in ../public/assets/audio/.
- Refined leaf gusts/settling, butterfly wingbeats/glides/banking, crab leg gait, damped tide ripples, and permanent wave-erasure of sand marks.
- Removed the user-marked GoPro helper text.
- Independent audit found/fixed sound continuity across scene changes and a P1 delayed-module race that could blank the active canvas. The audit's five browser cases and runtime regressions pass.

## Previous scene validation
- Production profiling covered all five scenes at normal/Retina sizes with high counts and repeated interactions. All cases held about60Hz; optimized the measured koi CPU hotspot by73–74% with the same raster/behavior.
- Passed 202 automated tests across23files and23browserchecks, TypeScript/build, formatting/whitespace, production smoke and visual evidence validation.
- Final screenshots, unpaused tour, audio checks and performance comparison are linked in final-evidence.md.

## Boundaries
No hosted deployment or upstream push. Physical floor coverage/alignment, projector contrast/latency, empty-projection false positives and overhead toddler play remain physical acceptance tasks. Audio decoding/mixing is tested; subjective speaker balance remains a listening check.

## Setup pass
Source-bound calibration, live output readiness, modal/cross-window setup guards, projector reload capture ownership, camera error recovery, mirror heartbeat freshness and floor dimension drafts are implemented. Camera startup cleanup and fixed-rate compatibility are hardened. Final verification is recorded in setup-flow-audit.md.
Final setup verification passed: 210 automated tests (24 files), 30 browser checks, TypeScript/build, formatting/whitespace and built-app camera smoke. Visible Chrome verified genuine popup fullscreen plus parent status. Setup screenshot evidence uses synthetic video; current enumeration did not find the GoPro.

## Live installed hardware pass
The real HERO10 stream decoded447frames while inference submitted only1. Added bounded latest-frame polling to survive missing hidden-video compositor callbacks; live tracking recovered to12–14fps with27–33ms model processing and60fps rendering. Refined/saved physical corner alignment, restored the output to the projector after development refresh, improved calibration preview quality, and retained65% sensitivity. The user confirmed: "Much better and follows my hand." Diagnostics are off and the app remains running. See live-hardware-tuning.md.
Final live-tuning verification:212automatedtests (24files),31browserchecks, TypeScript/production build, formatting/whitespace and built-app synthetic-camera smoke all passed. The real calibrated play session remains running.

## Tracking performance pass
Two real-GoPro optimized-build comparisons improved12.5→28.2–28.5trackingupdates/s. Added bounded30Hz scheduling, GPU hand detection with CPU recovery, calibrated hand focus and coordinate conversion, sample-rate-normalized motion, and guarded brief-contact detection. The control preview renders one loaded still after reload without a continuous second loop. Final live UI showed30trackingfps/60renderfps and preserved alignment.227tests and32browserchecks passed; physical hand/tap re-test remains pending user response.

## Repeat-tap pass
User feedback: hands follow better, but taps still miss. Added pose-based re-arming despite projected pixel activity and calibrated-floor selection before semantic motion fallback. Added generic camera-action/scene-response counters.234automatedtests and32browserchecks pass, including repeated taps at30Hz and off-floor arm competition. Build/format/whitespace checks passed. Live capture and alignment remain running; physical five-tap comparison is pending. See repeated-tap-audit.md.

Follow-up user result:3–4of5taps splashed. Reproduced/fixed another missed repeat when a resting landmark-tracked hand failed to re-arm the semantic fallback before a later landmark dropout. Added downstream filtering counters to distinguish deduplication, dry areas and expired/invalid actions.237unit tests and32browserchecks pass with build/format/whitespace checks. Physical retest after this change is pending; camera recovers with alignment intact and about30trackingfps/60renderfps. See repeated-tap-audit.md.

Final physical retest: user confirmed **all5taps splashed** after the handoff fix. Read-only live check retained saved alignment,65%sensitivity,1280×720GoPro,60renderfps and about28.6completedtrackingupdates/s averaged over the session. No settings/source changes at acceptance. This verifies the requested center repeat-tap case, not all positions/poses or toddler play.

## App bug sweep
Implemented fixes in an isolated copy first, then verified and applied 23 source/test files.251automatedtests (27files),39Chrome browser checks, TypeScript/production build, formatting/whitespace and built-app synthetic-camera/alignment smoke passed. New coverage includes discarded pre-reset worker work, reply deduplication, correct rate reporting, fallback confidence selection, silent/reloaded projector ownership, artwork retry (including inactive previews), scene recovery, bounded pending input, partial audio retry and silence for dry-area koi taps. The hardware session reconnected with saved alignment; final live state is recorded in bug-sweep-audit.md. No commit/push/deployment.

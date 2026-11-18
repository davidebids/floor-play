# Scene camera/edge coverage and reaction pass — 2026-11-14

## Physical first pass

The installed HERO10 Black and projector used the saved 6×4 ft alignment and 65% sensitivity. The user tested sweeping and lifted taps at the center and four sides. Findings were recorded separately from synthetic tests:

| Scene | User-observed result before refinements |
| --- | --- |
| Koi pond | Good except bottom left; missing/intermittent response rather than an offset. Several camera actions were rejected as dry-area taps. |
| Forest floor | Worked in all five areas, including the same bottom-left spot. Additional feedback: leaves accumulated at the top/right and taps were weaker than sweeping. |
| Tide pool | Sweeping worked; tap ripples did not feel reliable/clear. Crabs bunched together. |
| Butterfly meadow | Sweeping worked; taps felt weak. |
| Sandy beach | Sweeping worked, but taps felt weak and scattered dry-sand spots missed. Surf appeared static. User requested a couple more beach creatures. |

Forest floor's bottom-left result supports retaining the shared alignment while investigating scene feedback and pond-boundary filtering. It is not proof that every hand pose or tap was detected. Cumulative action counters are not a count of precisely timed test taps.

## Refined behavior

- Preserve eight tap marks independently from sixteen continuous-motion marks. Previously, a stream of motion marks could replace a tap while the hand still covered its short-lived feedback. The existing 24-mark shader capacity stays bounded.
- Increase the visibility of damped Tide pool ripple crests/troughs and sand impressions. Moderate leaf taps reach a wider neighborhood and produce a clearer airborne tumble; butterfly taps give a visible takeoff/escape response. This pass retains the existing camera models, thresholds, cooldowns, corner alignment and sensitivity.
- Rotate forest breeze direction and add soft edge/neighbor forces so a broad sweep does not permanently strand almost every leaf at one border. Ground friction still lets leaves settle. A reproduced test went from only four leaves inside the central area to satisfying a minimum of ten after the disturbance.
- Give crabs local avoidance plus bounded body-overlap resolution. A sustained broad-hand test reproduced nearly coincident crab centers before the fix. Test separation is checked both during pressure and after it is removed.
- Use a separate photographic wet-surface polygon for pond actions/splash clipping. Bottom-left shallows now respond while the original whole-fish navigation/render boundary stays unchanged. Rocks outside the wet polygon remain silent/dry. This is a conservative trace of the supplied artwork, subject to the physical retest below.
- Animate beach swash advancing and receding over a visible area with a moving water texture, foam and lingering wet sand. CPU mark erasure follows the same moving front as the shader. Default beach wildlife increases from two to four crabs, with a 2–8 control and alternating peripheral starting positions.

## Software coverage and limits

New unit coverage sends hand and semantic-foreground observations through perspective/mirrored mapping at the center, four sides, all four corners and just outside the calibrated quadrilateral. New browser cases send manufactured camera observations through mapping and the real scene/render path at twelve positions in each activity, checking scene-specific dry-area rejection. These fixtures do not establish physical model recognition accuracy.

Additional checks cover tap retention during continuous camera motion, surf advance/recession, extra beach crabs, leaf settling/recovery and crab separation. Nearby generated taps are spaced beyond the shared debounce interval rather than weakening that safeguard.

263 automated tests across 29 files, TypeScript/build, formatting and whitespace checks passed in the installed project. All 46 browser checks passed with no skipped or flaky cases. After the final meadow-only change, its mapped-camera browser case passed again. The seven scene/edge browser checks passed again after the final beach shader change. The built-app synthetic-camera/alignment smoke also passed, with no runtime/console errors or external model requests. Ten production-preview profiling cases covered all five scenes at 1280×720/DPR1 and 1920×1080/DPR2. Each median was 16.7 ms, worst p95 was 16.8 ms, no sampled frame exceeded 25 ms, and no runtime errors were reported. Each measurement lasted three seconds after warm-up with synthetic pointer interactions and no physical camera; it is not a thermal soak or sensor/projector-latency measurement.

## Acceptance status

The refinements were tested in an isolated copy before application to the running project. Source hashes are recorded in `qa/scene-edges-source-manifest.json`. The saved alignment and 65% sensitivity remain intact. Live readiness after the final meadow update showed 60 render fps, approximately 29 tracking updates/s and the 1280×720 HERO10 feed.

| Scene | Physical follow-up result |
| --- | --- |
| Koi pond | User confirmed all five bottom-left taps splashed and sweeping worked. |
| Tide pool | User accepted clearer ripples and separation, then requested slower crabs. After the pace reduction, user confirmed the pace was good. |
| Forest floor | Initial follow-up tap traveled too far. After reducing horizontal impulse/radius/spin, user confirmed the gentler lift and tumble felt good. |
| Butterfly meadow | Initial follow-up remained weak. A regression reproduced that a tap mostly influenced steering while presence already caused escape. Added a brief decaying takeoff translation; user confirmed taps now feel clear at the center/sides. Normal flight is unchanged. |
| Sandy beach | User rejected the initial wave appearance and the stretched rocks underneath it. Inspection found that the shader incorrectly treated the dry-sand image as a sea photograph. Replaced that sampling with clean sand in the swash zone, depth-dependent water transmission/refraction, continuous broken foam and wet-sand recession. Revised water holds 16.7 ms median/p95 in both tested sizes (4.5-second samples, no frames above 25 ms or browser errors). User physically confirmed: "Water, taps and crabs all feel good." |

These are adult hand tests in the installed setup, not exhaustive pose, lighting, occlusion or toddler acceptance. No user camera imagery was recorded or saved.

Final live check after beach acceptance retained 60 render fps, 28.8 tracking updates/s, 1280×720 HERO10 feed, 6×4 ft floor, 65% sensitivity and saved alignment. Diagnostics were hidden again. Sandy beach remains playing on the projector. No commit, push or hosted deployment.

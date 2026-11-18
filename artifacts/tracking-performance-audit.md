# Tracking performance and missed-contact pass — 2026-11-14

## Measured target

The installed HERO10 Black delivered 1280×720 video. The scene rendered 60 fps, but camera analysis updated about 10–14 times per second. The user additionally reported missed hands/taps. This pass targeted camera-to-interaction software throughput while retaining full scene artwork/resolution, the existing models, body segmentation, local processing, calibration and 65% sensitivity.

Experiments ran in an isolated source copy and optimized Vite build at 5193, using the real GoPro through a separate Chrome test profile. The installed app remained available. Reports contain timings/counts, not camera imagery. `qa/vision-performance/comparison.json` summarizes two back-to-back comparisons:

| Metric | Baseline | Optimized |
| --- | --- | --- |
| Completed updates/s, run1 |12.50|28.50|
| Completed updates/s, run2 |12.50|28.19|
| Median model/analysis time |28.7–28.8ms|23.0ms|
| p95 capture-submission-to-result age |35.0–35.9ms|30.5–32.5ms|

This is 2.26–2.28× as many analysis updates. These tests did not measure the GoPro's sensor/driver latency, the projector's display latency, or total physical action-to-photon latency. Neither timing comparison recognized hands, so these are throughput measurements, not hand/tap accuracy scores. A GPU-only experiment reduced median hand-stage time but did not improve throughput; the combined pacing/focus/backend change was retained only after repeat comparison.

Initial phase profiling found about 20 ms in CPU hand detection versus 4–5 ms in body segmentation. In the full installed app after the changes, native UI readings showed roughly 24–30 tracking fps (including a 30 fps sample),60renderfps,19–31 ms model time and 20–32 ms software frame age. One observed three-minute session submitted 4,938 frames from 5,183 decoded frames. Startup shader/model warm-up is excluded from steady-state claims. No long thermal soak or toddler acceptance is claimed.

## Changes

- Camera capture now targets 30 updates/s instead of a 70 ms minimum interval plus 80 ms polling. A bounded wake-up processes the newest advancing frame as soon as the preceding result returns. Only one frame may be in flight; unchanged frames are skipped. Hidden-video polling remains reliable and all timers stop with the camera.
- Hand inference prefers GPU with an explicit OffscreenCanvas, using the same local model and thresholds. GPU initialization or runtime failure falls back once to CPU. Both failure paths have regression coverage.
- The hand detector receives a padded crop around the valid calibrated floor, sampled from the original camera bitmap. This increases the useful hand scale in the model's input. Full-view CPU body segmentation remains intact. All hand landmarks are converted back into full-camera coordinates before the existing homography. Mirrored source crop and processed coordinates are handled once, with no double reflection. Invalid/unmatched calibration uses the full image.
- Image-difference energy and apparent hand-size change are normalized to a 100 ms reference interval. Increasing sampling frequency therefore does not make the same tap weaker. Amplification is bounded and stale/invalid image history contributes no motion energy.
- A brief entering hand may trigger a contact estimate only with recent image history, high-confidence landmarks and strong local pixel activity. First startup, quiet/static hands, low-confidence appearances, stale history and global illumination changes do not qualify. Cooldowns and resting-hand re-arming remain in place. This addresses contacts that end before a second landmark observation; it remains an approximate gesture estimate, not measured floor contact.
- The inactive control window draws one fully loaded still after scene/settings changes. It does not run a second continuous simulation/render loop or capture the camera. This fixes a black control preview after reload without adding continuous rendering work.
- Optional diagnostics show hand backend/phase timing and software frame age.

## Detection and coordinate checks

A controlled test used Google's published `woman_hands.jpg` sample, embedded at three sizes in a 1280×720 generated frame. Both versions detected both hands in all 24 sample frames each. The optimized full-camera palm coordinates differed from baseline by at most 0.0035 of the camera image. This verifies model execution and coordinate conversion on a known image; it does not establish performance under the user's projected patterns/occlusion. The sample was saved only as test material in the isolated reproduction archive, not as a scene asset.

At the original throughput handoff, the physical hand/tap re-test was pending. Subsequent user feedback confirmed: “Hands follow better, but taps still miss.” The follow-up gesture changes and pending five-tap acceptance check are documented in repeated-tap-audit.md. The earlier “much better” feedback belongs to the previous capture-stall fix.

## Verification and final state

227 automated tests across 26 files and all 32 Chrome browser checks passed, including crop/mirror mapping, GPU initialization/runtime fallback,30Hz bounded capture, frame-rate normalization, brief-contact safeguards, control reload still-image pixels and single camera ownership. TypeScript/production build, formatting and whitespace checks passed. Built-app synthetic-camera smoke was also rerun. The existing shared-library chunk-size warning remains informational.

The real projector session stayed running. Saved camera/floor alignment and 65% sensitivity were preserved; the actual pond remained visible through the camera preview. Final UI showed “Camera aligned · ready to play.” Diagnostics were hidden for normal use. No changes were made to scene art, render-resolution budgets or audio.

## Reproduction

`qa/vision-performance/reproduction.tar.gz` contains the frozen baseline source, final candidate source, optimized benchmark entry/configuration, runner and the public test photo. Extract to a temporary directory, link the project's node_modules, copy the project's public/ assets over its public/ directory without deleting fixtures, build with `vite build --config vite.bench.config.ts`, and serve with `vite preview --config vite.bench.config.ts --host 127.0.0.1 --port 5193`. Run `VISION_ACTUAL=1 VISION_KINDS=baseline,candidate node benchmark-vision.mjs`. The actual mode chooses only a GoPro/HERO label and does not open an alternate camera. Timing runs are 10 seconds per variant after a 2 second warm-up.

API references checked: [MediaPipe GPU delegate](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.baseoptions), [explicit GPU canvas](https://developers.google.cn/edge/api/mediapipe/js/tasks-vision.visiontaskoptions), [Google's public hand-test image source](https://github.com/google-ai-edge/mediapipe-samples/blob/main/examples/hand_landmarker/python/hand_landmarker.ipynb).

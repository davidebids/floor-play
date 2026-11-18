# Vision integration evidence

## Real connected camera
`artifacts/camera-smoke.json` was produced by `scripts/camera-smoke.mjs` with real Chrome camera permission, no synthetic camera flag, no recording and no saved camera imagery. The actual device label is **HERO10 Black**. GoPro Webcam utility needed to be launched; its own live preview was visually verified, then closed before browser capture. Prior to utility startup, the device enumerated and the track appeared live but delivered no playable frames.

Final real-camera run: 1280x720 stream, local models initialized, seven inference frames observed, warm processing approximately 23–43 ms (last three: 23–24 ms); latest-frame controller processed approximately 10 frames/s during this short check. Calibration gating suppresses all interactions until camera ID and actual resolution match the saved profile. Explicit identity test calibration enabled software ready state; stop cleared inputs and removed video. Camera lease teardown was fixed and verified by unit tests.

The current desk-facing view contained no detected hands/body. This does **not** establish overhead toddler recognition, gesture success, physical floor alignment, empty moving-projection false positives, or physical end-to-end latency. Those still require the intended floor installation and playtesting. The calibration in this script tests software gating only.

## Worker execution
`artifacts/vision-worker-smoke.json` uses generated blank canvas frames, not a camera. Both local person and hand models loaded, three frame inferences completed, no presence/motion/impulses emitted. Warm inference approximately 25ms. The MediaPipe classic WASM loader required a module-worker adapter (`vision/wasm-loader.ts`); it wraps the trusted local loader as an ES module without eval or node_modules edits.

## Focused tests
27 tests across vision motion, semantic gating, floor mapping/signatures, camera leases, denied permission, startup timeout/late track cleanup, cancelled starts, unsupported contexts, stale in-flight results, live format changes, frozen-preview recovery and gesture re-arming passed. TypeScript passed. Reproduction: start Vite on port5190 (or set PROJECTION_VISION_URL) and run `node scripts/camera-smoke.mjs` / `node scripts/vision-worker-smoke.mjs`. These script harnesses target Vite source-module URLs. No default recording is implemented.

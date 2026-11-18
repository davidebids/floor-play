# Functional gap audit — 2026-11-13

This pass follows the implementation handoff and the report that fish sometimes swim over dry rocks. It closes software gaps within the existing koi activity; it does not add future activities or claim physical floor acceptance.

## Changes

- Whole-fish shoreline containment: use a shared visible-water polygon for motion and rendering, keep head/trail clearance for fins and tail strokes, and mask fish/shadows at the bank.
- Camera lifecycle: clear old preview/signature/input after stop or failure, discard observations in flight across setup/pause changes, detect live video resolution changes, and clean up cancelled startup immediately.
- Gesture interpretation: require quiet or repositioning to re-arm large impulses, including the foreground fallback when hand landmarks are absent.
- Calibration: reject stopped/stale camera previews; show the alignment grid even if the pond was blanked, restore prior pause/blank/grid state, and label the actual floor dimensions. Tie saved calibration to output geometry so resizing/moving/fullscreen changes require realignment.
- Two-window recovery: release the camera before handing it back, preserve projector authority across control-page reloads, and report projector errors to the control window.
- Rendering recovery: catch update/render/configuration failures without losing the control loop, provide Reload pond, and recover from a restored WebGL context.
- Saved setup: recover from unavailable selected activities while preserving their preferences; reject malformed settings-array imports.

## Evidence boundary

Actual HERO10 Black capture was rechecked after the vision changes: 1280 × 720, local models, seven inference frames, warm inference 23–43 ms (last three: 23–24 ms), input gated until software calibration, clean stop. Metadata is in camera-smoke.json; no camera imagery was recorded. The desk view had no detected person/hands.

Final integration: 144 automated tests across 17 files, 15 browser checks, TypeScript/build, formatting, whitespace and visual evidence verification all passed. Production smoke passed with synthetic video, local assets only and development hooks absent. Fresh captures and motion are recorded under qa/; see final-evidence.md. Physical output coverage, four-corner alignment, empty-projection false positives, overhead hand/crawling recognition and projector latency still require the installed floor setup.

# Camera and projector setup audit — 2026-11-14

## Changes

- Alignment reuse now requires the same actual camera device, live resolution and active output signature. Imported or old profiles cannot silently bless stale corners.
- A marking session is bound to camera identity/resolution, mirroring, floor dimensions, output warp and output-window geometry. Changes clear earlier marks; Save verifies the session again.
- Mirrored remote previews carry the child's mirror state. Switching Mirror clears the old preview immediately, and queued old heartbeats cannot make it clickable again. Saving waits for a fresh live image and advancing inference; an already-visible fresh startup image can be marked immediately.
- Calibration is modal: focus stays within it, Escape cancels, and playback/blank/fullscreen shortcuts and projector toolbar actions are suspended in both windows. Cancel and control-window reload restore the preceding picture/grid/pause state. Cancellation cannot restore trust in changed hardware.
- Projector reload no longer causes the Mac to seize camera capture mid-navigation. A real close returns capture to the Mac; explicit navigation away has a bounded grace period. Ordinary background heartbeat throttling alone does not release a known open projector.
- Floor setup shows the current output/fullscreen status, puts projector corner adjustment before camera alignment, and displays alignment readiness for the active output. Missing saved cameras remain visible in the source selector. Camera startup/permission errors are shown with their controls and recover through Reconnect, without stale scene-reload alerts.
- Dimension drafts can be cleared/edited without shrinking the live output to the storage minimum. Valid 2–12 ft entries update immediately; invalid drafts clamp or restore on blur.
- Vision clears old preview/FPS on a live resolution transition, rejects worker startup failures consistently, closes an untransferred bitmap on failure, and treats 30 fps as a preference so fixed-rate cameras can connect.

## Regression evidence

`tests/e2e/setup-flow.spec.ts` covers stale imported camera profiles, changed-projector geometry, cross-window shortcut suppression, cancellation/control reload, projector reload/close capture ownership, dimension draft editing, camera permission failure/retry, and stale mirrored heartbeat rejection. Fixtures explicitly use synthetic video, not a physical camera.

`src/projection/setup.test.ts` checks camera/output reuse, all marking-source changes and cancellation trust. Vision session tests cover live-resolution preview invalidation, failed worker initialization, bitmap cleanup and best-effort frame rate.

## Hardware boundary

The latest actual-camera smoke enumerated Chrome's devices and did not find HERO10/GoPro, so it opened no alternate camera and recorded no imagery. Earlier live GoPro evidence remains historical. The real Nebula output, final mounted camera, overhead interaction quality, empty-projection false positives and action-to-image latency still require the installed arrangement.

## Final verification

- 210 automated tests across 24 files and all 30 Chrome browser tests passed.
- TypeScript/production build, formatting and whitespace checks passed. The existing shared-dependency chunk warning remains informational.
- Built-app synthetic-camera smoke passed: alignment saved, exactly one video element, no page/console errors, no external requests, and no development hooks exposed.
- Setup screens were inspected at 1440×1000, 656×852 and 390×844 with no horizontal overflow. Camera and output dialogs were visually inspected. Captures and measurements: `qa/setup/` and `qa/setup/evidence.json`.
- Real HTML fullscreen in the detached projector window and its parent status were verified in visible Chrome. On this Mac, headless Chrome rejects fullscreen specifically for popup windows even with user activation; visible Chrome succeeds on the first click. The screenshot command is `PROJECTION_HEADED=1 node scripts/setup-evidence.mjs`. It still uses synthetic video and opens no physical camera.

A later installed-hardware session on the same date connected the real GoPro and projector and verified improved hand-following with the user. That follow-up supersedes the earlier missing-device enumeration; see [live-hardware-tuning.md](live-hardware-tuning.md).

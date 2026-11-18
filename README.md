# Floor Play — Projection App

A local floor-projection play app, built around interchangeable scenes. Six scenes are installed: Koi pond, Forest floor, Tide pool, Butterfly meadow, Sandy beach, and Starlit cosmos. Each has detailed artwork and independent reactions and controls. The nature scenes use recorded audio; Starlit cosmos offers quiet musical tap chimes.

## Run

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5188/** in Chrome on the Mac. Node 24 LTS or a supported current Node release is recommended; this session also verified the build/tests under Node25.8.0, although Vitest5 warns that25 is outside its supported engine range. Runtime use is browser-only.

For a production build:

```sh
npm run build
npm run preview
```

The app and its model/WASM/font/image assets are served locally. There is no hosted service, telemetry, cloud camera processing, microphone request, or default recording. Install/build dependency downloads require Internet; the prepared runtime does not.

## First play

1. Connect the Mac to the Nebula Mars II Pro using HDMI and use an extended display. Target a dim room and a flat, plain floor/mat approximately 6 × 4 ft.
2. Open GoPro Webcam and connect HERO10 Black using a USB data cable. Confirm live video in its preview, then close the preview before app capture. The utility must remain running.
3. Open projector, move that window onto the projector display, then click Fullscreen (or F). Floor setup shows whether that output is windowed or fullscreen. Parent controls remain on the Mac.
4. Set Width/Depth, then Adjust projector corners if needed. Finish the floor and projector adjustment before camera alignment.
5. Choose HERO10 Black in Video source and Connect camera. Permit camera access in Chrome/macOS. The app prefers a recognized GoPro when Default camera exposes its label. Only the current output owner captures the camera; permission and connection errors appear beside its controls.
6. Select Align camera. In the live preview click the projected floor's four numbered corners in order: top-left, top-right, bottom-right, bottom-left. Save alignment. Interactions remain disabled until this camera/resolution and output geometry have a valid profile.
7. Tune Interaction sensitivity after trying the setup. Nearby hand hovering can trigger splashes; this is intentional approximate interaction, not measured physical contact.

Moving/resizing the projector window, changing fullscreen/display scale, or changing output corners requires camera realignment. A saved projector profile is preserved while using the Mac preview and can be reused if the live camera, resolution and projector geometry match. Changing the camera or output during alignment clears earlier corner marks. Cancel or Escape restores the previous picture/grid/pause state; playback/fullscreen shortcuts are suspended in both windows during alignment. Refreshing the projector retains camera ownership, and closing it returns capture to the Mac.

Actual projector operating orientation, coverage, brightness, shadows, and full action-to-image latency still require a physical installation check. The camera has been verified live on this Mac; overhead crawling/hand recognition during toddler play has not yet been validated.

## Scenes

- Koi pond: chase fish, make ripples and splash.
- Forest floor: sweep leaves into travelling gusts and watch them settle.
- Tide pool: send shore crabs scuttling and disturb clear water.
- Butterfly meadow: lift butterflies into wingbeats, glides and curved flight.
- Sandy beach: draw soft marks in the sand while waves wash the edge clean.
- Starlit cosmos: part the stars, nudge rotating planets, and tap to send a shooting star through a luminous nebula.

## Controls

- Scene: choose an installed activity. Choose between all six installed scenes.
- Mouse preview: the selected scene describes its controls. In Koi pond, move to repel fish and stir water; click to splash.
- Space: pause/resume. B: blank/restore picture. F: fullscreen. Keyboard shortcuts ignore form inputs.
- Scene settings: controls come from the selected scene. Koi pond supplies fish count and swimming pace. Sound and Volume control the selected scene’s soundscape or tap chimes; projector audio may need a user click in that window.
- Save/Load setup: portable JSON profile. Paused/blank/grid states clear on a fresh load. Revalidate alignment whenever hardware moves or camera lens/settings change.
- Reload scene: recovers a failed scene without reloading the controls. A restored browser graphics context also restarts the current scene automatically.
- Show diagnostics: render/tracking rates, model processing time, video dimensions and local tracking preview. Model time is not end-to-end latency.

Fullscreen output and all intermediate image layers adapt to the display’s pixel density (up to 8 MP, 4096 pixels per edge, and 4× logical scale). The simulation keeps the same world size. Fullscreen preview preserves the chosen floor proportions.

## Architecture and future activities

`src/projection/` owns camera/vision, calibration, settings, interaction contracts, runtime, activity registry and controls. `activities/koi.ts` consumes normalized presence/motion/impulse frames. Scene definitions provide their own label, description, pointer hint, controls and lazy loader. Activities implement configure/update/render/dispose and may own audio; the shared runtime does not create pond sound. Guarded async switching releases old resources and ignores obsolete loads. Per-activity preferences are stored separately; legacy top-level koi aliases remain only for v1 profile compatibility. The four nature scenes share the photographic NatureStage renderer; each owns its own movement and feedback behavior. Lazy scene factories check ownership before construction so late module loads cannot blank the active canvas.

The controls use a midnight, apricot and mint play-studio theme, with a scene thumbnail, compact inspector, transport dock and styled scene menu.

See [the scene platform](docs/SCENES.md), [the agreed plan](docs/IMPLEMENTATION-PLAN.md), [design brief](docs/design-brief.md), [asset provenance](docs/ASSETS.md), and [verification evidence](artifacts/final-evidence.md).

## Checks

```sh
npm test
npm run build
npm run test:e2e
npm run format:check
```

Browser tests require Chrome and a running dev server. Synthetic-camera tests are explicitly marked; they do not prove real-world tracking. `scripts/camera-smoke.mjs` tests the actual GoPro without recording imagery; set PROJECTION_VISION_URL=http://127.0.0.1:5188 when using the main dev server. `scripts/production-smoke.mjs` expects the production preview on5189 and uses a synthetic camera. `PROJECTION_HEADED=1 node scripts/setup-evidence.mjs` captures setup screens and verifies genuine projector fullscreen with synthetic video; use visible Chrome for this check because headless Chrome on this Mac rejects fullscreen for popup windows.

This project adapts [Nagomi](https://github.com/msk1039/nagomi). Its original license and required notice are retained in LICENSE; the original readme is preserved in docs/UPSTREAM.md.

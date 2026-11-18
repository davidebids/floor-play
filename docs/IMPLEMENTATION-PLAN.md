# Projection App: agreed implementation brief

Interactive floor-projection play app for young children. Hardware: MacBook M4 Pro, GoPro HERO10 Black using GoPro Webcam, Nebula Mars II Pro over HDMI. Target floor area 6 x 4 ft; dim room; elevated tripod or permitted ceiling arrangement; flat hard floor or plain play mat. Exact projector coverage/orientation, camera availability, and real-world delay remain physical validation tasks.

## Experience
A complete, lifelike garden koi pond: natural shoreline, stone/gravel bed, vegetation, visible water depth, coherent lighting, soft shadows, caustics, reflections/refraction, detailed procedurally swimming koi, overlapping ripples, localized splashes and optional quiet audio. Realism applies equally to environment, water, lighting and fish. Not a sparse fish demo. Image-generation skills must be used for appropriate assets and references, with integrated validation.

## Inputs
Presence regions repel fish locally; motion creates ripples; quick hand motions create larger impulses/splashes. Near-floor hovering may trigger splashes and is acceptable. No need for exact physical contact or pressure measurement. Resting hands should not continuously generate large splashes. No additional sensor purchase planned. Semantic person/hand evidence should prevent projected fish/water triggering feedback loops. Overhead toddler model reliability is unproven until physical testing.

## Architecture
Local-only Vite/TypeScript/React/Three.js app. Camera capture and worker inference independent from rendering. Shared normalized floor-space presence/motion/impulse contract. Parent controls and projector runtime communicate locally. One active camera owner; when projection window is open preview yields camera ownership. Versioned calibration profiles, mapping camera to floor and floor to projector with perspective transforms, stored locally. Configurable dimensions, confidence, stale-input expiry, camera loss recovery, diagnostics and pointer/replay paths. All runtime model/WASM/asset dependencies bundled locally; no telemetry or default recording.

Activities are first class: registry, lazy loader, lifecycle/update/render/configure/dispose contract, per-activity settings. Koi, forest floor, tide pool, butterfly meadow and sandy beach are implemented; other future activities can consume identical scene-independent inputs. No unfinished activities in UI.

## Validation
Build/typecheck plus existing upstream tests, meaningful mapping/interaction/lifecycle/recovery tests, browser tests for controls/calibration/persistence/camera errors/two-window messaging, production static-server check, screenshots and unpaused motion evidence, renderer diagnostics. Target 60 fps render, 30 acceptable; latest-frame inference with no queue; aim for ~150ms physical response subject to device pipeline. Physical GoPro/projector/toddler validation is separate from automated/browser evidence.

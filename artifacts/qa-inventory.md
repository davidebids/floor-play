# QA inventory

Evidence covers desktop controls at 1440 × 1000, compact laptop at 1024 × 768, projector at 1280 × 720, and a narrow control layout at 390 × 844.

- Generated pond/fish assets load; water, shore, vegetation, caustics and layered depth are visible in screenshots and an unpaused sequence.
- Pointer motion repels fish; pointer clicks create splashes/ripples. Resting input does not repeat impulses.
- Pause freezes simulation; Resume restores it; Blank blacks the floor and can be restored.
- Fish count/pace and sound/volume controls update runtime behavior.
- Calibration rejects invalid quads and missing camera profiles; output editing invalidates camera alignment and cancellation restores it.
- Dimensions preserve the selected aspect; square/tall output fits its window. Saved setup/import survives reload.
- The projector receives settings, takes camera ownership, supports fullscreen and returns rendering to the parent on close.
- Real GoPro enumeration, capture, model initialization, calibration gating and stop were verified. No default recording.
- Permission denial, unavailable devices, cancelled startup and camera lease cleanup are covered.
- Production checks found no browser/runtime errors or external requests and no exposed development hooks.
- Render counts/assets and motion evidence are recorded; physical brightness, latency and children's responses remain unverified.

See final-evidence.md for results and the physical installation checklist.

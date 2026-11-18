# Scene platform

Floor Play is the app. Five scenes are installed: Koi pond, Forest floor, Tide pool, Butterfly meadow, and Sandy beach.

## Shared app

The app shell owns the scene picker, projector window, camera, calibration, saved setup, input interpretation, master sound/volume, pause/blank, diagnostics and recovery. Its midnight/apricot/mint styling and geometric identity apply across scenes. Scene art appears in the stage and the scene's thumbnail, rather than becoming the app brand.

`src/projection/registry.ts` describes each installed scene: identity, title, description, optional thumbnail, interaction hint, numeric control definitions, sound availability and lazy loader. The app reads this metadata instead of hardcoding koi controls or labels.

## Scene module

An activity implements configure, update, render, diagnostics and dispose. It consumes normalized presence, motion and impulse frames; a scene decides what those mean. Koi turns them into fish avoidance, ripples and splashes. Other activities can interpret the same inputs differently.

An activity can supply optional `audio` hooks (unlock, configure, impulse). It owns and disposes its audio resources. Recorded soundscapes and natural tap variants are selected in `activities/scene-audio.ts`; `activities/koi-audio.ts` is the koi adapter. the shared runtime does not create it. Scenes without audio still work.

Preferences live under `activitySettings[sceneId]`; scene controls update that entry with `setActivitySettings`. Legacy top-level fish fields remain for v1 setup compatibility. They are not the pattern for another scene's preferences.

## Display detail

The current renderer separates logical world coordinates from output pixels. The reusable render-size policy covers CSS size × display density while bounding raster allocations to 8,388,608 pixels, 4096 pixels per edge and 4× logical scale. The canvas and both compositing layers use the same output dimensions; world/camera/calibration units do not change with pixel density. Tiny size changes reuse buffers, and hidden/inactive previews retain their allocation until visible.

## Validation for a future scene

Verify scene switching and disposal, isolated preferences, scene-owned sound, the existing camera/calibration contract, projector ownership, physical-display sizing, pointer input, recovery, and appearance in the same app chrome. Do not add unfinished activities to the picker. Scene loaders return factories; the runtime checks current canvas ownership after loading and before constructing a renderer.

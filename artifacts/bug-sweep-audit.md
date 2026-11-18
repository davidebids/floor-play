# Camera, projector and app bug sweep — 2026-11-14

## Scope and method

Reviewed camera acquisition/teardown, worker resets, gesture fallback selection, calibration/output trust, cross-window ownership, scene loading/recovery, interaction queues and recorded audio. Candidate changes were first implemented and tested in an isolated source copy at `/private/tmp/projection-sweep.xh6ecF` (port 5194), leaving the accepted physical setup running on 5188. Browser regression fixtures explicitly use synthetic camera input. No user camera imagery was recorded or saved, and no gesture confidence thresholds, cooldowns, saved corner positions or sensitivity were reduced to make the sweep pass.

## Defects reproduced and fixed

| Area | Failure | Resolution and regression evidence |
| --- | --- | --- |
| Vision reset | Hand inference yielding asynchronously could finish after reset and repopulate pre-reset image/gesture history; an obsolete failure could also be surfaced as current. | Worker revisions discard both obsolete success and failure, acknowledge completion with empty input, and close the bitmap. Tests reproduce reset while inference is unresolved and then process fresh mirrored input. |
| Vision replies | Duplicate or mismatched replies could recount actions or free the slot for work still in flight. | Accept only the outstanding frame ID while busy. Tests verify no recount and no extra capture when an older reply arrives. |
| Tracking readout | Reciprocal time between results spiked above the camera's actual processing cadence when model execution time changed. | Rolling cadence uses source timestamps of fresh completed frames; resets/stalls clear its history and stopped sessions clear backend/timing values. A variable-inference-time regression prevents the spike. |
| Gesture fallback | A stronger motion candidate below the existing confidence requirement could hide a weaker candidate that met it. | Rank only candidates satisfying the unchanged confidence requirement. A two-candidate regression selects the eligible tap. |
| Projector connection | Missing updates could leave positive camera readiness and old preview imagery displayed. Reloaded controls without a popup handle could start competing capture/rendering while the projector still existed. | Expire remote readiness/preview, retain a browser-owned projector lease, and check ownership before handback. Browser cases suppress heartbeats, reload controls, restore updates, and close the projector. |
| Scene recovery | A previous scene error could survive successful switching; failed old graphics cleanup could block the new scene. | Clear reported errors on successful installation and allow switching to continue after old cleanup fails. Unit regressions exercise both transitions. |
| Artwork failure | Pond images swallowed download errors; an inactive preview could wait indefinitely for missing artwork. Reload while projecting could retry only the remote scene rather than the failed local preview. | Surface asset failures through the normal recovery flow and retry the actual failed owner. Browser tests fail each pond image and an inactive forest preview, then restore loading and recover. |
| Pending actions | Input arriving while an activity was loading could replay on its first visible frame; pending actions could accumulate while no scene sampled them. | Gate pointer/camera/replay input on an installed activity and expire queued actions during ingestion. Tests cover all three input paths and 100 events without sampling. |
| Partial audio failure | Successfully loaded effects prevented a failed ambience download from retrying on later camera gestures. | Later impulses retry missing recordings with the existing backoff, without discarding loaded clips. Test starts with three of four files loaded, then verifies ambience recovers. |
| Scene/audio agreement | Koi taps rejected on rocks still played a water effect. | Activities may return accepted impulses for sound; the runtime retains the default behavior for other scenes. Koi returns water-accepted actions. Browser instrumentation verifies border tap silence and center tap splash plus sound. |

## Validation status

251 automated tests across 27 files pass, along with TypeScript/production build and formatting. New regressions were run against the old code before the corresponding fixes where applicable. The final complete Chrome run passed **39/39 browser checks**, with zero skipped, unexpected or flaky results. It includes scene pixels/animation, all five activities, camera permission/recovery, calibration changes, mirroring, output geometry, pause/blank, graphics context recovery, sound continuity and the new sweep regressions. Results: `qa/bug-sweep-e2e.json`.

The isolated server initially blocked a symlinked font outside its file allow list; only the temporary server configuration was corrected. An earlier inactive-preview recovery wait failed once and then passed three repeats; final-suite evidence is recorded below rather than treating a retry alone as completion. The projector-close test also had a race: positive remote fps could satisfy its wait before the local video existed. Its assertion now waits for local ownership before validating tracking/video, and passed three repeats. No production wait was lengthened to mask that assertion race.

The verified candidate was applied to 23 source/test files. `qa/bug-sweep-source-manifest.json` records before/after hashes, and the installed source was checked against the tested candidate byte-for-byte. Unit tests, build, formatting and whitespace checks passed again in the actual project. The production smoke on 5189 then passed camera startup/alignment with synthetic input, no runtime/console errors, no external requests and no exposed development replay hook; see `qa/production-smoke.json`. The existing large-audio-chunk advisory remains informational. The temporary sweep server was stopped after validation.

## Final installed state

Native Chrome showed the original HERO10 Black session reacquired automatically after the update, with 1280×720 video, 65% sensitivity, the existing 6×4 ft geometry and "Camera aligned · ready to play". Steady UI samples showed 28.4–28.9 tracking updates/s and 60 render fps. At 79.7 seconds, 2,276 observations had completed from 2,389 decoded video frames; the camera preview visibly contained the projected pond. The inactive controls retained their textured still while the projector owned play. No hand was present during the final check; this is a startup/throughput/alignment check, not a new physical gesture-accuracy test. No settings were changed during final UI inspection. The app/projector were left running with diagnostics visible.

## Boundaries

The prior physical result remains "All 5 splashed" for center taps after the handoff fix. That is not evidence of whole-floor accuracy, all poses, lighting conditions or toddler play. This sweep does not change the saved physical geometry or claim those additional acceptance cases. No deployment, commit or push is included.

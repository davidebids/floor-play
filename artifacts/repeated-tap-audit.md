# Repeat-tap recovery — 2026-11-14

## Observed problem and scope

The user confirmed that hands follow better after the throughput pass, but taps still miss. This pass changes gesture selection/re-arming, retaining the existing models, GPU path, 30 Hz capture schedule, calibration and 65% sensitivity. It does not claim measured floor contact.

Two code paths could discard an intended action:

- A hand could remain disarmed after its first action because projected texture kept local pixel activity above the quiet threshold. A small repeat lift in the same spot did not necessarily satisfy the displacement re-arm rule.
- During a landmark dropout, the semantic foreground fallback selected the strongest motion across the full camera. Stronger off-floor arm motion could win and then be rejected by floor mapping. A hand outside the floor could also suppress fallback for valid motion inside it.

These are demonstrated logic defects, not a measurement of how many physical misses each caused.

## Changes

- Smooth position/radius only for tap decisions, preserving responsive raw hand presence and impact coordinates. A pose that settles for 80 ms can re-arm independently of projected pixel noise. A pose-rearmed action requires fresh geometry motion, preventing stationary projected flicker from repeatedly splashing. Existing per-hand cooldown, confidence, stale-frame and illumination guards remain.
- Use the valid calibrated camera quadrilateral to select eligible hand/motion observations before fallback ranking. Full-view semantic foreground and illumination analysis remain intact; absent/invalid calibration retains the full-view behavior. Off-floor hands cannot suppress in-floor fallback.
- Add optional generic diagnostics for camera actions and scene responses, to distinguish detection from scene handling. The camera counter counts floor-mapped actions only while playing with valid calibration, and resets when capture stops.

## Verification

234 automated tests across 26 files and all 32 Chrome browser checks passed. Added coverage exercises five separated repeat taps at 30 Hz after initial contact with noisy projected pixels, same-position lifts, resting-pose jitter/flicker suppression, off-floor foreground competition, off-floor hands, reversed quad winding, uncalibrated fallback, and counter pause/alignment/reset behavior. Browser checks include camera ownership/recovery and calibration across projector reloads. TypeScript/production build, formatting and whitespace checks passed.

The installed GoPro session remained active after source updates: about 24–30 instantaneous tracking fps, 60 render fps, with saved alignment intact and the pond visible in the camera preview. The original handoff session had processed 3,429 frames over 119.7 seconds (about 28.6/s including startup). No camera imagery was saved. Automated gesture tests do not establish physical tap accuracy or toddler acceptance.

## Follow-up: intermittent hand-model dropout

The user reported that only 3–4 of five taps visibly splashed. On resuming, cumulative diagnostics read 8 camera actions / 5 scene responses, and later 29 / 24. These totals span uncontrolled hand movements and cannot establish five-tap accuracy or explain the gap by themselves. They also show why downstream filtering must be distinguished from a missed gesture.

A further regression test reproduced a fallback handoff defect: fallback fires once, landmarks regain the resting hand for several frames, then landmarks disappear on the next semantic motion pulse. The fallback remained disarmed because it only observed quiet frames when landmarks were absent. The next pulse was lost even after its cooldown. Quiet semantic motion now re-arms fallback regardless of landmark availability; only action emission requires absent hands. Continuous foreground motion and global lighting changes still cannot re-arm it. No gesture thresholds, cooldowns or sensitivity were changed.

Added optional filtered-action diagnostics separating spatial repeat suppression, koi dry-area rejection, and stale/invalid input. These counters are diagnostic only; they do not bypass scene boundaries or duplicate suppression. A unit test verifies counters and reset behavior.

237 automated tests across 26 files and all 32 Chrome browser checks passed after the follow-up, as did TypeScript/production build, formatting and whitespace checks. The live camera reacquired automatically and retained "Camera aligned · ready to play", 1280×720 feed and 60 fps rendering. The final UI sample showed 30.5 tracking fps, 2,580 completed observations over 90.1 seconds, and no detected hand/actions since the final reload. A new five-tap physical retest was requested after the final source update; its result is pending. This fix closes a demonstrated state transition gap but is not yet physically accepted.

## Physical retest accepted

The user subsequently reported **"All 5 splashed"** for the requested five center taps with lifts between them after the detector handoff fix. This accepts that particular physical repeat-tap case; it does not establish whole-floor accuracy, all hand poses or toddler play.

A read-only live check confirmed HERO10 Black at 1280×720, "Camera aligned · ready to play", projector connected, 65% sensitivity and 60 render fps. Capture had processed 61,811 observations over 2,161.9 seconds (about 28.6/s including startup). The instantaneous tracking-fps label read 66.2 at that one sample, so it is not used as a throughput measurement. Cumulative counters were 15 camera actions / 9 scene responses, with all six filtered actions labeled outside water and zero repeated or stale/invalid actions. These cumulative totals are not a count of the user's five test taps. No source or setup settings were changed for this acceptance check; camera/projector remain running.

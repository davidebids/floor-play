# Live camera and projector tuning — 2026-11-14

## Reproduction on the installed setup

The user reported delayed or misplaced reactions with the GoPro and projector connected. The running regular Chrome app, rather than a separate test profile, was inspected through native UI. The output owned a real HERO10 Black stream at 1280×720. Rendering remained 60 fps, but tracking reported 0 fps and repeatedly cleared stale interaction frames.

Temporary diagnostics were made permanent under Show diagnostics: camera media time, decoded frames and submitted inference frames. The baseline showed 14.9 seconds of advancing video, 447 decoded frames, and only one submitted inference frame. This isolated capture scheduling from camera connectivity and model processing.

## Fixes

- Added an 80 ms latest-frame polling fallback alongside the video compositor callback. A hidden video can continue decoding while Chrome stops presenting it, so compositor callbacks cannot be the sole scheduler. The fallback requires advancing media time, respects the existing minimum interval and one-frame-in-flight guard, and is removed on stop/disposal. It never queues a backlog or processes an unchanged frame again.
- Kept semantic hand landmarks as precise presence regions as well as motion/strike inputs. A recognized resting hand now repels fish even when the coarser person mask misses that part of the arm. A new hand appearing does not become a strike, and missing hands do not leave cached presence behind.
- Sharpened the local alignment preview from 320px/JPEG0.65 to at most 640px/JPEG0.8 for more accurate corner placement. Changed the SVG selector to apply only to the direct alignment overlay, fixing the oversized placeholder camera icon.

## Physical configuration and observed result

The actual projected rectangle was inspected in the live camera preview and the four corners were adjusted/saved. A development refresh exited the original fullscreen arrangement; the detached output was restored on the projector using macOS fullscreen and alignment was saved again for its final geometry. No further source changes were made after that final alignment. The GoPro remained selected, floor dimensions remained 6×4ft, and sensitivity remained65% because the user confirmed the result: "Much better and follows my hand" after a requested hand sweep, hold and three-tap test.

Readings after the capture fix included 13.2fps/33ms model processing; the final saved setup showed 13.9fps/27ms, 7,784 decoded frames and2,119 submitted frames, with rendering60fps. Intermediate fullscreen/background transitions temporarily reduced tracking, so these are sampled operating readings rather than a sustained latency benchmark. Processing time is not total camera-to-projection latency. The actual GoPro hand count also reached1 during inspection. The final UI showed "Camera aligned · ready to play"; diagnostics were then switched off, and camera tracking/playback were left running.

This was an adult hand test, not a completed overhead toddler trial or a quantitative score of every tap. No camera video or still frame files were saved into the project. Earlier synthetic evidence and earlier missing-GoPro enumeration remain historical and do not describe this connected run.

## Regression coverage

New focused tests suppress compositor callbacks while advancing decoded video and verify continued inference, bounded in-flight work, unchanged-frame suppression and stop cleanup. A browser case exercises the same callback suppression with synthetic video. A gesture test verifies stationary hand presence independently of the body mask without generating repeated strikes or mutating observations.

## Final validation

212 automated tests in24files, all31Chrome browser checks, TypeScript/production build, formatting and whitespace checks passed. The built-app synthetic camera smoke also passed with one video element, saved alignment, no page/console errors or external requests, and no development hooks exposed. The live installed Chrome session was left running independently of those isolated test profiles.

A subsequent performance/missed-contact pass supersedes the80ms capture cadence described above. See [tracking-performance-audit.md](tracking-performance-audit.md): repeat real-GoPro timing runs improved12.5→28.2–28.5updates/s while preserving the installed alignment. New physical hand/tap acceptance is tracked separately from the earlier positive user response.

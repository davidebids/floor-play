# Recorded nature sound library

Prepared 2026-11-13 for the personal Projection App. All shipped sounds derive from **real recordings and practical Foley**, not generated brown/white noise or a music bed. ElevenLabs credentials were checked in the shell and were unavailable; no paid generation service was used.

The ambience, water and leaf recordings are by **Joseph SARDIN**, published by [BigSoundBank](https://bigsoundbank.com/). Butterfly wings are an actual peacock-butterfly recording by **Yuval** on Freesound. Sand brush derives from **Peludo**'s dry-grain Foley on OpenGameArt ([author's requested itch.io credit](https://rnan.itch.io)). All are explicitly **CC0 / public domain equivalent** on their individual source pages and permit processing and redistribution. Credit is retained here even though the source does not require it. `sources.json` records exact source WAV URLs; `analysis.json` records each local derivative, processing, SHA-256, bytes, and measured loudness/true peak.

| Local asset | Original source | Use |
| --- | --- | --- |
| `pond-stream.mp3` | [Brooklet #864](https://bigsoundbank.com/brooklet-s0864.html), 18–46s | Koi: gentle real stream water |
| `forest-birds.mp3` | [Forest #100](https://bigsoundbank.com/forest-s0100.html), 6–38s | Forest floor: birds and woodland ambience |
| `meadow-breeze.mp3` | [Forest wind in the trees #904](https://bigsoundbank.com/forest-wind-in-the-trees-s0904.html), 30–62s, mixed with [Forest #100](https://bigsoundbank.com/forest-s0100.html), 18–50s | Meadow: softer breeze with distant birds |
| `tide-rocks.mp3` | [Small waves, rocks and beach #1445](https://bigsoundbank.com/small-waves-rocks-and-beach-s1445.html), 42–74s | Tide pool: actual small rocky shore waves |
| `beach-surf.mp3` | [Small waves, froth and beach #1447](https://bigsoundbank.com/small-waves-froth-and-beach-s1447.html), 18–50s | Sandy beach: actual waves and foam over sand |
| `water-plop-a.mp3` | [Small splash #5 / #1533](https://bigsoundbank.com/splash-small-5-s1533.html) | Koi: restrained pond splash |
| `water-plop-b.mp3` | [Small splash #6 / #1534](https://bigsoundbank.com/plouf-petit-6-s1534.html) | Alternate water contact |
| `water-plop-c.mp3` | [Small splash #3 / #1531](https://bigsoundbank.com/plouf-petit-3-s1531.html) | Alternate water contact |
| `leaf-rustle-a.mp3`, `-b`, `-c` | [Feet in leaves #137](https://bigsoundbank.com/feet-in-leaves-s0137.html) | Forest: three separate short foliage rustles, restrained mix |

| `wing-flutter-a.mp3`, `-b`, `-c` | [butterfly wings.wav by Yuval](https://freesound.org/people/Yuval/sounds/198818/), public HQ MP3 preview | Meadow: three brief real wing movements, softened attack and release |
| `sand-brush-a.mp3`, `-b`, `-c` | [Water splash and sand footsteps by Peludo](https://opengameart.org/content/water-splash-and-sand-footsteps), sand-footsteps file | Beach: dry granular brush/pat, not water |
| `tide-touch-a.mp3`, `-b`, `-c` | The three small-splash sources above | Tide pool: separate softened water-touch derivatives with 35ms attacks, gentler EQ, and long release |

## Processing and mix

20 MP3 files total approximately 2.7 MB, 44.1 kHz / 128 kbit/s. Ambience retains original mono/stereo placement. Gentle high-pass and low-pass filters reduce handling rumble and brittle high frequencies without synthesizing a replacement background. Ambient excerpts target -25 LUFS (-26 for meadow); measured output is approximately -24.8 to -28.2 LUFS. Measured true peaks are at or below -6.4 dBTP. Transient effect normalization is peak limited at -7 to -12 dBTP; very short one-shot integrated loudness is less representative than its peak. Exact measured values and source excerpt positions are in `analysis.json`.

Runtime graph: each clip → individual envelope → ambience/effects bus → shared volume master → output. Scene balance is stored in `SCENE_SOUNDTRACKS`. Koi is calm water, forest includes birds, meadow emphasizes breeze, tide pool uses rock wash, beach uses sandy surf. Impulse variants rotate with a small ±3% playback-rate difference, 200 ms cooldown and a three-voice limit. All effects respect the same mute, volume, pause and blank state as ambience. Sound starts only after a user gesture and remains disabled by default.

Ambience repeats using two-second overlapping source envelopes scheduled against the audio clock. The first fade-in is 0.5s; overlapping complements avoid hard loop boundaries. A scene owns its context and disconnects/stops every source on disposal. A shared LRU decoded-buffer cache is capped at 16 entries / 64 MiB, keyed by output sample rate. Failed loads are removed so they can be retried after a short backoff. All runtime asset requests are local to this folder.

## Verification and remaining acceptance

- 13 focused unit tests cover the master graph, mute/pause/zero volume, variants/voice cap, loop scheduling, delayed loading, retry, bounded cache, and disposal.
- `artifacts/audio-browser.json`: actual shipped MP3s were decoded and rendered in installed Chrome. All five activities produced a nonzero ambience signal and separate isolated impulse signal; pause measured exactly zero; all resumed. Koi's first two-source loop overlap also remained nonzero. No page errors. This test used numeric analyser readings and did not record audio or use a microphone.
- Headphone/speaker listening and the final subjective balance on the projector/Mac remain a listening acceptance step. Numeric rendering and source metadata do not establish that the mix sounds good to a person. Source forest ambience may retain faint distant environmental noise; no voice isolation or AI resynthesis was performed.

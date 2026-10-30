# Recorded demos

Scenes of the app, driven by Playwright and recorded as video: reproducible,
sample data only, re-recorded whenever the app changes. Not part of
`pnpm test:e2e`.

```bash
pnpm video                       # record every scene and every film's cards
pnpm video e2e-video/recovery-words.spec.js
DEMO_LANG=de pnpm video e2e-video/recovery-words.spec.js   # the German app, German lines
pnpm video:compose out           # MP4 + voice + .srt per recording, into out/
pnpm video:compose out --film e2e-video/films/words-en.json
                                 # … and the film: cards and scenes end to end
```

A scene's clip is named after its spec and language (`recovery-words.en`,
`recovery-words.de`); a film after its list (`words-en`, `words-de`).

Playwright wipes `e2e-video/results/` on the next run, so compose at once.

## The kit (`kit/`)

- `scene.js` — `startScene(page, context, LINES)` returns `say`, `click`,
  `type`, `beat`, `markStart`, `finish`. Every `say` is a cue: when it
  started, what was said, how long the voice is. `markStart()` says the
  picture is ready from here (compose cuts what comes before; without it, 800
  ms before the first line). `finish(testInfo, { name })` writes `cues.json`
  beside the video; the name is the clip's name in out/ (default: the spec's).
- `voice.mjs` — the narrator. ElevenLabs when a key is in the keychain
  (`security add-generic-password -a belege -s elevenlabs -w`) or in
  `ELEVENLABS_API_KEY`; each line is made once and kept under its hash in
  `e2e-video/voice/` (not in git: a minute of speech costs cents, and a
  recording without a key has no narrator). `DEMO_VOICE=say` uses macOS's voice for a dry run,
  `DEMO_VOICE=none` records silence. `node e2e-video/kit/voice.mjs voices`
  lists the voices; `ELEVENLABS_VOICE_ID` picks one (default: George),
  `ELEVENLABS_MODEL` the model (default: `eleven_v4`, which reads IPA between
  slashes: the `PRONOUNCE` table in `voice.mjs` gives "Belege" its German
  sound; captions keep the written word).
- `cursor.js` — a pointer the viewer can see: glides to each target with
  easing and a little overshoot, sinks on the click. Playwright still does the
  clicking; the pointer only shows where.
- `../captions.js` — the caption bar, baked into the frame (`DEMO_CAPTIONS=0`
  turns it off; the `.srt` is written either way).
- `card.js` — the title cards: the opening (the signet draws itself, then the
  wordmark and the tagline), a card before each scene (eyebrow, title, line),
  the closing card (facts, address, QR to the app). Brand colours and type
  (Sora, from `brand/`); nothing from the network. `cards.spec.js` records
  the cards of every film in `films/`.

The scene waits for each line's voice before it acts, so the clicks follow the
narrator. `compose.mjs` lays the voice files onto the video from the cues, cuts
the dead time before the first line, and writes subtitles. The video's clock
starts with the page, some seconds before the scene's: `startScene` turns the
blank page dark at once, and compose reads that frame's time off the recording
to shift the cues onto the video's clock.

## Picture

A 1920×1080 viewport, recorded as it is (`playwright.video.config.js`), with
the page enlarged 1.5× by the scene kit (root font size; `DEMO_ZOOM` changes
it, `1` turns it off): the app's laptop layout, readable at 1080p. Playwright's
video never scales a page up, a device scale factor does not reach the
recording, and CSS `zoom` makes Playwright miss its targets — the rem-based
layout is what scales cleanly.

## Films (`films/*.json`)

A film is a list of parts in order: cards (`{ "card": "intro" }`,
`{ "card": "scene", "eyebrow", "title", "sub" }`, `{ "card": "outro" }`) and
scenes (`{ "scene": "recovery-words.en" }`, the clip's name in out/), with the
film's `lang`. The scenes of a German film are recorded with `DEMO_LANG=de`. `pnpm video` records its cards (`cards.spec.js`), the scenes
are recorded by their specs, and `compose.mjs --film` joins what is in out/:
every part faded from and to the brand's night, silence where a part has no
voice, one `.srt` for the whole. The intro and outro cards have their texts
and narration per language in `card.js`; a card's `say` overrides them
(`null` for a silent card).

## Scenes

| Spec                     | Shows                                                                                                                                        | Length |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `belege-demo.spec.js`    | passkey, bank, receipts, matching, backup, wipe, restore (scene 1 of the Devcon 8 video)                                                     | 2:00   |
| `qr-pairing.spec.js`     | two devices by QR, no relay (scene 2)                                                                                                        | 0:46   |
| `recovery-words.spec.js` | 24 words made; every passkey gone; the words open the same books on an empty device                                                          | ~1:30  |
| `backup.spec.js`         | passkey, six bookings through the bridge, one sealed backup on Aleph, the browser forgets, the address finds the backup, the books come back | ~1:30  |

The two older scenes bake their captions and have no narrator yet
(`compose.sh` handles them); porting them to the kit is a matter of replacing
`say(page, …)` with `scene.say(…)` and the clicks with `scene.click(…)`.

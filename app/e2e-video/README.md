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

`pnpm video:thumbnail out e2e-video/films/words-en.json` writes the film's
thumbnail (its scene card, still, 1920×1080; YouTube scales it).

A scene's clip is named after its spec and language (`recovery-words.en`,
`recovery-words.de`); a film after its list (`words-en`, `words-de`).

Playwright wipes `e2e-video/results/` on the next run, so compose at once.

## The kit (`@le-space/video-kit`)

The kit is a package of its own, `packages/video-kit`, shared with Le
Space's other apps; read its README for what each part does. Belege's side
is here:

- `belege.js` — Belege's brand on the title cards (the signet, the Sora
  wordmark, the style guide's colours, the opening and closing texts per
  language, the address and its QR), the narrator's voice folder
  `e2e-video/voice/` and how it says "Belege" (`/beˈleːɡə/`, read by Eleven
  v4), and `startScene` with both. A spec imports `startScene` from here.
- `cards.spec.js` — records the cards of every film in `films/`.
- `compose.mjs`, `thumbnail.mjs` — the kit's compose and thumbnail on
  Belege's night.
- `voice.mjs` — `node e2e-video/voice.mjs voices` lists the voices the key
  can use; `ELEVENLABS_VOICE_ID` picks one (default: George),
  `ELEVENLABS_MODEL` the model (default: `eleven_v4`).
- `brand/` — the Sora font file.

The narrator is ElevenLabs when a key is in the keychain
(`security add-generic-password -a belege -s elevenlabs -w`) or in
`ELEVENLABS_API_KEY`; each line is made once and kept under its hash in
`e2e-video/voice/` (not in git: a minute of speech costs cents, and a
recording without a key has no narrator). `DEMO_VOICE=say` uses macOS's voice
for a dry run, `DEMO_VOICE=none` records silence. The caption bar is baked
into the frame (`DEMO_CAPTIONS=0` turns it off; the `.srt` is written either
way).

The scene waits for each line's voice before it acts, so the clicks follow the
narrator. Compose lays the voice files onto the video from the cues, cuts
the dead time before the first line, and writes subtitles. The video's clock
starts with the page, some seconds before the scene's: `startScene` turns the
blank page dark at once, and compose reads that frame's time off the recording
to shift the cues onto the video's clock.

## Picture

A 16:9 viewport, recorded as it is (`playwright.video.config.js`; `DEMO_RES`
is its height, 1080 by default), with the page enlarged by the scene kit (root
font size, 1.5× at 1080p and with the frame; `DEMO_ZOOM` changes it, `1` turns
it off): the app's laptop layout, the same at every size. Playwright's video
never scales a page up, a device scale factor does not reach the recording,
and CSS `zoom` makes Playwright miss its targets — the rem-based layout is
what scales cleanly; the kit's captions, pointer and cards follow the frame.

Record at `DEMO_RES=2160` for YouTube: a 1080p upload gets a thin bitrate
there and text goes soft, a 4K upload keeps it crisp at every size the viewer
picks. Playwright's own recorder is patched for that as well
(`patches/playwright-core@1.61.1.patch`): it caps its VP8 at 1 Mbit/s, which
smears text before anything else gets to see it.

## Films (`films/*.json`)

A film is a list of parts in order: cards (`{ "card": "intro" }`,
`{ "card": "scene", "eyebrow", "title", "sub" }`, `{ "card": "outro" }`) and
scenes (`{ "scene": "recovery-words.en" }`, the clip's name in out/), with the
film's `lang`. The scenes of a German film are recorded with `DEMO_LANG=de`. `pnpm video` records its cards (`cards.spec.js`), the scenes
are recorded by their specs, and `compose.mjs --film` joins what is in out/:
every part faded from and to the brand's night, silence where a part has no
voice, one `.srt` for the whole. The intro and outro cards have their texts
and narration per language in `belege.js`; a card's `say` overrides them
(`null` for a silent card).

`films/devcon-en.json` joins two scenes into one film for the Devcon 8
research submission: the backup and back (`backup.en`), then the recovery
words (`recovery-words.en`), each after its own card. Record both scenes,
then compose it like any other film.

## Scenes

| Spec                     | Shows                                                                                                                                        | Length |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `belege-demo.spec.js`    | passkey, bank, receipts, matching, backup, wipe, restore (scene 1 of the Devcon 8 video)                                                     | 2:00   |
| `qr-pairing.spec.js`     | two devices by QR, no relay (scene 2)                                                                                                        | 0:46   |
| `recovery-words.spec.js` | 24 words made; every passkey gone; the words open the same books on an empty device                                                          | ~1:30  |
| `intro.spec.js`          | what Belege is: passkey, sample books, Home, Payments, Receipts, questions, export, keys                                                     | ~1:20  |
| `backup.spec.js`         | passkey, six bookings through the bridge, one sealed backup on Aleph, the browser forgets, the address finds the backup, the books come back | ~1:30  |

The two older scenes bake their captions and have no narrator yet
(`compose.sh` handles them; their captions come from the kit's
`@le-space/video-kit/captions`); porting them to the kit is a matter of
replacing `say(page, …)` with `scene.say(…)` and the clicks with
`scene.click(…)`.

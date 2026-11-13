# @le-space/video-kit

Narrated demo films of a web app, recorded by Playwright: reproducible, from
sample data, re-recorded whenever the app changes. Made for
[Belege](https://github.com/Le-Space/belege) (`app/e2e-video/`) and used by
other Le Space apps for their own films.

- **Scenes** (`/scene`): `startScene(page, context, LINES, { voice, night, lang })`
  returns `say`, `click`, `type`, `beat`, `markStart`, `finish`. Every `say`
  is a cue: when it started, what was said, how long the voice is; the scene
  waits for the voice before it acts, so the clicks follow the narrator.
  `finish(testInfo, { name, dir })` writes `cues.json` beside the video
  (`dir` for a second browser in the same test, which records into a folder
  of its own).
- **Captions and pointer** (`/captions`, `/cursor`): a caption bar baked into
  the frame (`DEMO_CAPTIONS=0` turns it off; the `.srt` is written either
  way), and a pointer the viewer can see, gliding to each target and sinking
  on the click. Playwright still does the clicking.
- **The narrator** (`/voice`): `createVoice({ dir, pronounce, keychainService })`.
  ElevenLabs when a key is in the macOS keychain (generic password, service
  `elevenlabs` by default) or in `ELEVENLABS_API_KEY`; each line is made once
  and kept under its hash in `dir` (keep it out of git). `DEMO_VOICE=say`
  uses macOS's voice for a dry run, `DEMO_VOICE=none` records silence.
  `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL` pick the voice and the model
  (default `eleven_v4`, which reads the IPA of `pronounce` between slashes;
  captions keep the written word).
- **Title cards** (`/card`, `/record-cards`, `/qr`): `createCards(brand)` makes
  the opening card, a card before each scene and the closing card in the
  caller's brand — mark, wordmark, palette, typeface (as a data URI), the
  texts per language, the address and its QR (`qrSvg`, through `qrencode`).
  `recordCards(test, { films, cards, scene })` records every card of every
  film list in a folder.
- **Films** (`/compose`, `/thumbnail`): `composeResults` lays each
  recording's voice onto its video and writes subtitles; `composeFilm` joins
  cards and scenes from a film list (`{ "lang", "parts": [{ "card": "intro" },
{ "card": "scene", "eyebrow", "title", "sub" }, { "scene": "<clip>" },
{ "card": "outro" }] }`), each part faded from and to the brand's night,
  with one `.srt`. `thumbnails` writes a still of a film's scene card.

The cards and the subtitles (`.`, `/card`, `/subtitles`) run in a browser as
well as in Node (`test/browser.test.js`); the rest is Node, with ffmpeg,
ffprobe and, for the QR, qrencode on the PATH.

## In an app

```js
// e2e-video/brand.js
import { createCards } from '@le-space/video-kit/card';
import { startScene as kitStartScene } from '@le-space/video-kit/scene';
import { createVoice } from '@le-space/video-kit/voice';

export const NIGHT = '#101820';
export const voice = createVoice({ dir: new URL('./voice/', import.meta.url).pathname });
export const startScene = (page, context, lines, o = {}) =>
	kitStartScene(page, context, lines, { voice, night: NIGHT, ...o });
export const cards = createCards({ name: 'My App', mark: () => '<svg class="mark" …/>', … });
```

```js
// e2e-video/cards.spec.js
import { test } from '@playwright/test';
import { recordCards } from '@le-space/video-kit/record-cards';
import { cards, NIGHT, voice } from './brand.js';
recordCards(test, {
	films: new URL('./films/', import.meta.url),
	cards,
	scene: { voice, night: NIGHT }
});
```

```js
// e2e-video/compose.mjs
import { composeCli } from '@le-space/video-kit/compose';
composeCli(process.argv.slice(2), {
	results: 'e2e-video/results',
	night: '#101820'
});
```

Record with a 16:9 viewport and `video: { mode: 'on', size: viewport }`; the
scene enlarges the page by its root font size (`DEMO_ZOOM`, 1.5× at 1080p),
since Playwright's video never scales a page up. Playwright 1.61's recorder
caps VP8 at 1 Mbit/s, which smears text; Belege's
`patches/playwright-core@1.61.1.patch` lifts the cap.

```bash
pnpm --filter @le-space/video-kit test   # Node, and the cards in Chromium
```

Moved with its history from Belege's `app/e2e-video/kit/`. AGPL-3.0-or-later.

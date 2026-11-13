// The title cards of every film in films/, recorded one by one: the page
// from Belege's brand (belege.js), its animation started, the narrator (if
// the card says anything), and a cues.json so compose treats the card like a
// scene. A film is then `pnpm video:compose <out> --film e2e-video/films/<id>.json`.
import { test } from '@playwright/test';
import { recordCards } from '@le-space/video-kit/record-cards';
import { cards, NIGHT, voice } from './belege.js';

recordCards(test, {
	films: new URL('./films/', import.meta.url),
	cards,
	scene: { voice, night: NIGHT }
});

// A film's thumbnail: its scene card, still, 1920×1080 (the kit's, in
// Belege's brand).
//
//   node e2e-video/thumbnail.mjs <out dir> e2e-video/films/words-en.json [more films …]
import { thumbnails } from '@le-space/video-kit/thumbnail';
import { cards } from './belege.js';

const [out, ...films] = process.argv.slice(2);
if (!out || !films.length) {
	console.error('usage: node e2e-video/thumbnail.mjs <out dir> films/<id>.json …');
	process.exit(1);
}
await thumbnails({ out, films, cards });

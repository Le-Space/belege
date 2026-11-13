// After a recording run: every result with its voice and subtitles into
// <out dir>, and with --film a film's cards and scenes end to end (the kit's
// compose, on Belege's night). Playwright wipes results/ on the next run, so
// compose at once.
//
//   node e2e-video/compose.mjs <out dir> [--film e2e-video/films/<id>.json]
import { fileURLToPath } from 'node:url';
import { composeCli } from '@le-space/video-kit/compose';

composeCli(process.argv.slice(2), {
	results: fileURLToPath(new URL('./results/', import.meta.url)),
	night: '#0b0e15'
});

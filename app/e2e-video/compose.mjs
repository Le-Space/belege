// After a recording run: for every result that has cues.json, lay the voice
// onto the video, write subtitles, and keep an MP4 — Playwright wipes
// results/ on the next run, so this copies out at once.
//
//   node e2e-video/compose.mjs <out dir>
//   node e2e-video/compose.mjs <out dir> --film films/<id>.json
//
// With --film, the film's parts (cards and scenes, all already in <out dir>)
// are laid end to end into <out dir>/<id>.mp4, each part fading from and to
// the brand's night, with one .srt for the whole film.
//
// A result without cues.json (the older scenes) is converted as it is.
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardName } from './kit/card.js';

const here = dirname(fileURLToPath(import.meta.url));
const results = resolve(here, 'results');
const args = process.argv.slice(2);
const filmArg = args.includes('--film') ? args[args.indexOf('--film') + 1] : null;
const out = resolve(args.find((a) => !a.startsWith('--') && a !== filmArg) || 'out');
mkdirSync(out, { recursive: true });

const NIGHT = '0x0b0e15';
const FADE = 0.4;
const VIDEO = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22'];
const AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

const ms2srt = (ms) => {
	const h = Math.floor(ms / 3600000),
		m = Math.floor((ms % 3600000) / 60000),
		s = Math.floor((ms % 60000) / 1000),
		x = Math.round(ms % 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};
const srt2ms = (t) => {
	const m = /(\d+):(\d+):(\d+),(\d+)/.exec(t);
	return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : 0;
};
const ffmpeg = (a) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...a]);
const durationMs = (file) =>
	Math.round(
		1000 *
			parseFloat(
				execFileSync('ffprobe', [
					'-v',
					'error',
					'-show_entries',
					'format=duration',
					'-of',
					'csv=p=0',
					file
				]).toString()
			)
	);
const hasAudio = (file) =>
	execFileSync('ffprobe', [
		'-v',
		'error',
		'-select_streams',
		'a',
		'-show_entries',
		'stream=codec_type',
		'-of',
		'csv=p=0',
		file
	])
		.toString()
		.includes('audio');

/**
 * The video's time of the scene's first dark frame: the blank page turned
 * night at the scene's marker (kit/scene.js), so this minus the marker is
 * what the video's clock is ahead of the cues' clock. null if no dark frame
 * shows in the first half minute.
 */
function firstDarkMs(video) {
	const log = execFileSync(
		'ffmpeg',
		[
			'-nostdin',
			'-v',
			'error',
			'-t',
			'30',
			'-i',
			video,
			'-vf',
			'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
			'-f',
			'null',
			'-'
		],
		{ encoding: 'utf8', maxBuffer: 64 << 20 }
	);
	let t = null;
	for (const line of log.split('\n')) {
		const pts = /pts_time:([\d.]+)/.exec(line);
		if (pts) t = Math.round(parseFloat(pts[1]) * 1000);
		const y = /YAVG=([\d.]+)/.exec(line);
		if (y && parseFloat(y[1]) < 60 && t != null) return t;
	}
	return null;
}

/** results/ → out/: every recording with its voice and subtitles. */
function composeResults() {
	if (!existsSync(results)) return;
	for (const dir of readdirSync(results, { withFileTypes: true }).filter((d) => d.isDirectory())) {
		const folder = join(results, dir.name);
		const videos = readdirSync(folder).filter((f) => f.endsWith('.webm'));
		if (videos.length !== 1) continue;
		const video = join(folder, videos[0]);
		const cuesFile = join(folder, 'cues.json');
		const meta = existsSync(cuesFile) ? JSON.parse(readFileSync(cuesFile, 'utf8')) : null;
		const name = meta?.name || dir.name.replace(/-chromium$/, '').replace(/-[0-9a-f]{5,}-.*$/, '');
		const target = join(out, `${name}.mp4`);
		if (!meta) {
			ffmpeg(['-i', video, ...VIDEO, '-movflags', '+faststart', target]);
			console.log(`${name}: ${target} (no cues)`);
			continue;
		}
		// The cues' clock onto the video's (see firstDarkMs); without a marker,
		// the two are taken as one.
		let offset = 0;
		if (meta.marker != null) {
			const dark = firstDarkMs(video);
			if (dark == null) console.warn(`${name}: no dark frame found, the cues may be off`);
			else offset = dark - meta.marker;
		}
		const raw = meta.cues.map((c) => ({ ...c, t: c.t + offset }));
		// The recording starts with the page, before the picture is ready: cut
		// to the scene's start mark, or 800 ms before its first line, and shift
		// every cue by the same amount.
		const trim = meta.start != null ? meta.start + offset : Math.max(0, (raw[0]?.t ?? 0) - 800);
		const cues = raw.map((c) => ({ ...c, t: c.t - trim }));
		const spoken = cues.filter((c) => c.file);

		// Subtitles: a cue lasts its voice, or until the next one.
		const srt = cues
			.map((c, i) => {
				const end = Math.min(c.t + Math.max(c.durationMs, 1200), cues[i + 1]?.t ?? Infinity);
				return `${i + 1}\n${ms2srt(c.t)} --> ${ms2srt(end)}\n${c.text}\n`;
			})
			.join('\n');
		writeFileSync(join(out, `${name}.srt`), srt);

		if (!spoken.length) {
			ffmpeg([
				'-ss',
				(trim / 1000).toFixed(3),
				'-i',
				video,
				...VIDEO,
				'-movflags',
				'+faststart',
				target
			]);
			console.log(`${name}: ${target}, ${cues.length} cues, no voice`);
			continue;
		}
		// Each voice file delayed to its cue, mixed over silence, under the video.
		const inputs = ['-ss', (trim / 1000).toFixed(3), '-i', video];
		const chains = [];
		spoken.forEach((c, i) => {
			inputs.push('-i', c.file);
			chains.push(`[${i + 1}:a]adelay=${c.t}|${c.t}[v${i}]`);
		});
		const mix = `${spoken.map((_, i) => `[v${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0[voice]`;
		ffmpeg([
			...inputs,
			'-filter_complex',
			`${chains.join(';')};${mix}`,
			'-map',
			'0:v',
			'-map',
			'[voice]',
			...VIDEO,
			...AUDIO,
			'-shortest',
			'-movflags',
			'+faststart',
			target
		]);
		console.log(
			`${name}: ${target}, ${cues.length} cues, ${spoken.length} spoken, clock +${offset} ms → ${basename(target)} + .srt`
		);
	}
}

/**
 * The film: its parts from out/, each faded in and out of night and given a
 * sound track (silence where there is none), joined without re-encoding the
 * joins, and the subtitles shifted into one file.
 */
function composeFilm(filmPath) {
	const film = JSON.parse(readFileSync(filmPath, 'utf8'));
	const id = basename(filmPath).replace(/\.json$/, '');
	const parts = film.parts.map((part, i) => (part.card ? cardName(id, i, part) : part.scene));
	const missing = parts.filter((p) => !existsSync(join(out, `${p}.mp4`)));
	if (missing.length)
		throw new Error(`film ${id}: not in ${out}: ${missing.join(', ')} (record them first)`);

	const tmp = mkdtempSync(join(tmpdir(), 'belege-film-'));
	const list = [];
	const srt = [];
	let offset = 0;
	let n = 0;
	for (const p of parts) {
		const src = join(out, `${p}.mp4`);
		const dur = durationMs(src) / 1000;
		const piece = join(tmp, `${p}.mp4`);
		const fadeOut = Math.max(0, dur - FADE).toFixed(3);
		const vf = `fade=t=in:st=0:d=${FADE}:color=${NIGHT},fade=t=out:st=${fadeOut}:d=${FADE}:color=${NIGHT}`;
		const af = `afade=t=in:st=0:d=${FADE},afade=t=out:st=${fadeOut}:d=${FADE}`;
		if (hasAudio(src)) {
			ffmpeg(['-i', src, '-vf', vf, '-af', af, ...VIDEO, ...AUDIO, piece]);
		} else {
			ffmpeg([
				'-i',
				src,
				'-f',
				'lavfi',
				'-i',
				'anullsrc=r=48000:cl=stereo',
				'-vf',
				vf,
				'-map',
				'0:v',
				'-map',
				'1:a',
				'-shortest',
				...VIDEO,
				...AUDIO,
				piece
			]);
		}
		list.push(`file '${piece.replace(/'/g, "'\\''")}'`);
		const partSrt = join(out, `${p}.srt`);
		if (existsSync(partSrt)) {
			for (const block of readFileSync(partSrt, 'utf8')
				.trim()
				.split(/\n\s*\n/)) {
				const lines = block.split('\n');
				if (lines.length < 3) continue;
				const [a, b] = lines[1].split(' --> ');
				srt.push(
					`${++n}\n${ms2srt(srt2ms(a) + offset)} --> ${ms2srt(srt2ms(b) + offset)}\n${lines.slice(2).join('\n')}\n`
				);
			}
		}
		offset += durationMs(piece);
	}
	const listFile = join(tmp, 'list.txt');
	writeFileSync(listFile, list.join('\n') + '\n');
	const target = join(out, `${id}.mp4`);
	ffmpeg([
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		listFile,
		'-c',
		'copy',
		'-movflags',
		'+faststart',
		target
	]);
	writeFileSync(join(out, `${id}.srt`), srt.join('\n'));
	rmSync(tmp, { recursive: true, force: true });
	console.log(
		`film ${id}: ${target}, ${parts.length} parts, ${(offset / 1000).toFixed(1)} s → ${id}.mp4 + .srt`
	);
}

composeResults();
if (filmArg) composeFilm(resolve(filmArg));

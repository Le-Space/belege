// SPDX-License-Identifier: AGPL-3.0-or-later
// After a recording run: for every result that has cues.json, lay the voice
// onto the video, write subtitles, and keep an MP4 — Playwright wipes its
// results on the next run, so this copies out at once.
//
//   composeResults({ results: 'e2e-video/results', out: 'out' });
//   composeFilm({ film: 'e2e-video/films/intro-en.json', out: 'out', night: '#0b0e15' });
//
// A film's parts (cards and scenes, all already in out) are laid end to end
// into <out>/<id>.mp4, each part fading from and to the brand's night, with
// one .srt for the whole film. A result without cues.json is converted as it
// is. `composeCli` is the command line around both. Node only; ffmpeg and
// ffprobe on the PATH.
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
import { basename, join, resolve } from 'node:path';
import { cardName } from './card.js';
import { cuesToSrt, ms2srt, srt2ms } from './subtitles.js';

const FADE = 0.4;
const VIDEO = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22'];
const AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

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
 * night at the scene's marker (scene.js), so this minus the marker is
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

/**
 * results → out: every recording with its voice and subtitles.
 * @param {{ results: string, out: string }} dirs
 */
export function composeResults({ results, out }) {
	results = resolve(results);
	out = resolve(out);
	mkdirSync(out, { recursive: true });
	if (!existsSync(results)) return;
	for (const dir of readdirSync(results, { withFileTypes: true }).filter((d) => d.isDirectory())) {
		const folder = join(results, dir.name);
		// A stage (stage.js): several recordings, laid into one frame.
		const stageCues = join(folder, 'stage', 'cues.json');
		if (existsSync(stageCues)) {
			composeStage(JSON.parse(readFileSync(stageCues, 'utf8')), out);
			continue;
		}
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
		writeFileSync(join(out, `${name}.srt`), cuesToSrt(cues));

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
 * Cues with the cut stretches left out: a cue inside one goes, a later one
 * moves up by what was cut before it.
 * @template {{ t: number }} C
 * @param {C[]} cues @param {{ from: number, to: number }[]} cuts sorted
 * @returns {C[]}
 */
export function cutCues(cues, cuts) {
	return cues
		.filter((c) => !cuts.some((x) => c.t >= x.from && c.t < x.to))
		.map((c) => ({
			...c,
			t: c.t - cuts.filter((x) => x.to <= c.t).reduce((sum, x) => sum + (x.to - x.from), 0)
		}));
}

/**
 * One stage (stage.js) → <out>/<name>.mp4 and .srt: every device's video laid
 * onto the stage's at its place, all on the cues' clock, the voice under it.
 * @param {{ name: string, marker: number, start: number | null,
 *   stage: { video: string, width: number, height: number,
 *     devices: { name: string, video: string, marker: number, x: number, y: number }[] },
 *   cues: { t: number, text: string, durationMs: number, file: string | null }[] }} meta
 * @param {string} out
 */
export function composeStage(meta, out) {
	const { name, stage } = meta;
	const target = join(out, `${name}.mp4`);
	/** How far a video's clock is ahead of the cues'. @param {string} video @param {number} marker */
	const offsetOf = (video, marker) => {
		const dark = firstDarkMs(video);
		if (dark == null)
			console.warn(`${name}: no dark frame in ${basename(video)}, the cues may be off`);
		return dark == null ? 0 : dark - marker;
	};
	const trim = meta.start != null ? meta.start : Math.max(0, (meta.cues[0]?.t ?? 0) - 800);
	const cues = meta.cues.map((c) => ({ ...c, t: c.t - trim }));
	// Stretches left out (stage.cutWhile), on the film's clock, in order.
	const cuts = (meta.cuts ?? [])
		.map((c) => ({ from: Math.max(0, c.from - trim), to: c.to - trim }))
		.filter((c) => c.to > c.from)
		.sort((a, b) => a.from - b.from);
	writeFileSync(join(out, `${name}.srt`), cuesToSrt(cutCues(cues, cuts)));

	const videos = [{ video: stage.video, marker: meta.marker }, ...stage.devices];
	const inputs = [];
	for (const v of videos) {
		const at = Math.max(0, trim + offsetOf(v.video, v.marker));
		inputs.push('-ss', (at / 1000).toFixed(3), '-i', v.video);
	}
	// Left out of picture and voice alike; what follows moves up.
	const keep = cuts.length
		? `not(${cuts.map((c) => `between(t,${(c.from / 1000).toFixed(3)},${(c.to / 1000).toFixed(3)})`).join('+')})`
		: null;
	const chains = [];
	let last = '0:v';
	stage.devices.forEach((d, i) => {
		const next = i === stage.devices.length - 1 ? 'picture' : `p${i}`;
		const out = keep && next === 'picture' ? 'whole' : next;
		chains.push(`[${last}][${i + 1}:v]overlay=x=${d.x}:y=${d.y}:eof_action=repeat[${out}]`);
		last = next;
	});
	if (!stage.devices.length) chains.push(`[0:v]null[${keep ? 'whole' : 'picture'}]`);
	// A constant rate first: the recordings' own is variable, and the frames are counted.
	if (keep) chains.push(`[whole]fps=25,select='${keep}',setpts=N/25/TB[picture]`);
	const spoken = cues.filter((c) => c.file);
	const audio = [];
	spoken.forEach((c, i) => {
		inputs.push('-i', /** @type {string} */ (c.file));
		audio.push(`[${videos.length + i}:a]adelay=${c.t}|${c.t}[v${i}]`);
	});
	// Padded with silence: the picture, not the last line, sets the length.
	if (spoken.length)
		audio.push(
			`${spoken.map((_, i) => `[v${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,apad${keep ? `,aselect='${keep}',asetpts=N/SR/TB` : ''}[voice]`
		);
	ffmpeg([
		...inputs,
		'-filter_complex',
		[...chains, ...audio].join(';'),
		'-map',
		'[picture]',
		...(spoken.length ? ['-map', '[voice]', ...AUDIO] : []),
		...VIDEO,
		'-shortest',
		'-movflags',
		'+faststart',
		target
	]);
	console.log(
		`${name}: ${target}, ${stage.devices.length} devices on one stage, ${cues.length} cues, ${spoken.length} spoken → ${basename(target)} + .srt`
	);
}

/**
 * The film: its parts from out, each faded in and out of night and given a
 * sound track (silence where there is none), joined without re-encoding the
 * joins, and the subtitles shifted into one file.
 * @param {{ film: string, out: string, night?: string }} o night: the brand's
 *   background, as #rrggbb
 */
export function composeFilm({ film: filmPath, out, night = '#0b0e15' }) {
	out = resolve(out);
	const NIGHT = night.replace(/^#/, '0x');
	const film = JSON.parse(readFileSync(filmPath, 'utf8'));
	const id = basename(filmPath).replace(/\.json$/, '');
	const parts = film.parts.map((part, i) => (part.card ? cardName(id, i, part) : part.scene));
	const missing = parts.filter((p) => !existsSync(join(out, `${p}.mp4`)));
	if (missing.length)
		throw new Error(`film ${id}: not in ${out}: ${missing.join(', ')} (record them first)`);

	const tmp = mkdtempSync(join(tmpdir(), 'video-kit-film-'));
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

/**
 * The command line: `<out dir> [--film films/<id>.json]`.
 * @param {string[]} args
 * @param {{ results: string, night?: string }} o
 */
export function composeCli(args, { results, night }) {
	const filmArg = args.includes('--film') ? args[args.indexOf('--film') + 1] : null;
	const out = resolve(args.find((a) => !a.startsWith('--') && a !== filmArg) || 'out');
	composeResults({ results, out });
	if (filmArg) composeFilm({ film: resolve(filmArg), out, night });
}

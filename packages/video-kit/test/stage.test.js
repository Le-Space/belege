// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeStage } from '../src/compose.js';
import { stageHtml } from '../src/stage.js';

test('the stage page frames each device at its place, scaled, its name escaped', () => {
	const html = stageHtml({
		width: 3840,
		height: 2160,
		night: '#101010',
		scale: 2,
		spots: [
			{ name: 'laptop', label: 'Laptop', x: 40, y: 90, width: 1100, height: 720 },
			{ name: 'phone', label: 'Phone <b>', x: 1180, y: 90, width: 340, height: 720 }
		]
	});
	assert.match(html, /id="device-laptop" style="left:80px;top:180px;width:2200px;height:1440px"/);
	assert.match(html, /<div class="label">Phone &lt;b&gt;<\/div>/);
	assert.match(html, /background: #101010/);
});

/** A video that is white for `white` s, then night for `dark` s. */
function clip(file, { width, height, white, dark }) {
	execFileSync('ffmpeg', [
		'-nostdin',
		'-v',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		`color=white:s=${width}x${height}:r=25:d=${white}`,
		'-f',
		'lavfi',
		'-i',
		`color=0x101010:s=${width}x${height}:r=25:d=${dark}`,
		'-filter_complex',
		'[0:v][1:v]concat=n=2:v=1[v]',
		'-map',
		'[v]',
		'-c:v',
		'libvpx',
		'-b:v',
		'200k',
		file
	]);
}

const probe = (file, entries) =>
	execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file])
		.toString()
		.trim();

test('the devices are laid onto the stage, each on the cues’ clock', () => {
	const dir = mkdtempSync(join(tmpdir(), 'video-kit-stage-'));
	try {
		clip(join(dir, 'stage.webm'), { width: 320, height: 180, white: 0.4, dark: 3 });
		clip(join(dir, 'a.webm'), { width: 120, height: 80, white: 0.8, dark: 3 });
		clip(join(dir, 'b.webm'), { width: 60, height: 100, white: 0.2, dark: 3 });
		// Half a second of voice: the picture, not the voice, sets the length.
		execFileSync('ffmpeg', [
			'-nostdin',
			'-v',
			'error',
			'-y',
			'-f',
			'lavfi',
			'-i',
			'sine=d=0.5',
			join(dir, 'line.mp3')
		]);
		composeStage(
			{
				name: 'stage.en',
				marker: 0,
				start: 200,
				stage: {
					video: join(dir, 'stage.webm'),
					width: 320,
					height: 180,
					devices: [
						{
							name: 'a',
							video: join(dir, 'a.webm'),
							marker: 0,
							x: 10,
							y: 20,
							width: 120,
							height: 80
						},
						{
							name: 'b',
							video: join(dir, 'b.webm'),
							marker: 0,
							x: 200,
							y: 40,
							width: 60,
							height: 100
						}
					]
				},
				cues: [{ t: 1200, text: 'Hello.', durationMs: 500, file: join(dir, 'line.mp3') }]
			},
			dir
		);
		assert.equal(probe(join(dir, 'stage.en.mp4'), 'stream=width,height'), '320,180');
		const seconds = Number(probe(join(dir, 'stage.en.mp4'), 'format=duration'));
		assert.ok(seconds > 2.5 && seconds < 3.4, `${seconds} s: the stage's, from its start mark`);
		// The cue, shifted by the start mark.
		assert.match(readFileSync(join(dir, 'stage.en.srt'), 'utf8'), /00:00:01,000 --> /);
		// From the first frame on, each device is past its own white start: its
		// video was cut by its own clock, not the stage's.
		for (const [x, y, w, h] of [
			[10, 20, 120, 80],
			[200, 40, 60, 100]
		]) {
			const y_ = execFileSync(
				'ffmpeg',
				[
					'-nostdin',
					'-v',
					'error',
					'-i',
					join(dir, 'stage.en.mp4'),
					'-frames:v',
					'1',
					'-vf',
					`crop=${w}:${h}:${x}:${y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
					'-f',
					'null',
					'-'
				],
				{ encoding: 'utf8' }
			);
			assert.ok(Number(/YAVG=([\d.]+)/.exec(y_)?.[1]) < 60, `the device at ${x},${y} is dark`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

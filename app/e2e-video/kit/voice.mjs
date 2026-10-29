// The narrator. Every line a scene says is spoken once by ElevenLabs and kept
// under its hash in e2e-video/voice/, so a re-recording does not pay or wait
// for the same sentence twice. The scene waits for each line's length before
// it acts, which is what keeps the clicks on the voice.
//
// The key is read from the macOS keychain (service "elevenlabs") or
// ELEVENLABS_API_KEY, never printed. Without a key, DEMO_VOICE=say uses
// macOS's own voice for a dry run, DEMO_VOICE=none records silence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'voice');
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
// "George", one of ElevenLabs' premade voices: calm, British, reads a product.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

function apiKey() {
	if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
	try {
		return execFileSync('security', ['find-generic-password', '-s', 'elevenlabs', '-w'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return '';
	}
}

/** Which narrator this run has: 'elevenlabs' | 'say' | 'none'. */
export function provider() {
	const wanted = process.env.DEMO_VOICE;
	if (wanted === 'none' || wanted === 'say') return wanted;
	if (apiKey()) return 'elevenlabs';
	return wanted === 'elevenlabs' ? 'elevenlabs' : 'none';
}

/** @param {string} file */
function durationMs(file) {
	const out = execFileSync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
		{ encoding: 'utf8' }
	);
	return Math.round(Number(out.trim()) * 1000);
}

/**
 * The spoken file for a line, made if missing.
 *
 * @param {string} text
 * @param {{ lang?: 'en' | 'de' }} [options]
 * @returns {Promise<{ file: string, durationMs: number } | null>} null without a narrator
 */
export async function speak(text, { lang = 'en' } = {}) {
	const kind = provider();
	if (kind === 'none') return null;
	mkdirSync(DIR, { recursive: true });
	const hash = createHash('sha256')
		.update(`${kind}:${kind === 'elevenlabs' ? `${MODEL}:${VOICE_ID}` : lang}:${text}`)
		.digest('hex')
		.slice(0, 20);
	const file = resolve(DIR, `${hash}.mp3`);
	if (!existsSync(file)) {
		if (kind === 'say') {
			const aiff = resolve(DIR, `${hash}.aiff`);
			execFileSync('say', ['-v', lang === 'de' ? 'Anna' : 'Daniel', '-o', aiff, text]);
			execFileSync('ffmpeg', [
				'-nostdin',
				'-v',
				'error',
				'-y',
				'-i',
				aiff,
				'-codec:a',
				'libmp3lame',
				'-q:a',
				'3',
				file
			]);
		} else {
			const key = apiKey();
			if (!key)
				throw new Error('ElevenLabs: no key (keychain service "elevenlabs" or ELEVENLABS_API_KEY)');
			const res = await fetch(
				`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
				{
					method: 'POST',
					headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
					body: JSON.stringify({
						text,
						model_id: MODEL,
						voice_settings: {
							stability: 0.5,
							similarity_boost: 0.75,
							style: 0.15,
							use_speaker_boost: true
						}
					})
				}
			);
			if (!res.ok)
				throw new Error(`ElevenLabs: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
			writeFileSync(file, Buffer.from(await res.arrayBuffer()));
		}
	}
	return { file, durationMs: durationMs(file) };
}

/** Make every line of a scene up front, so the recording never waits for the network. */
export async function prepare(lines, options) {
	const out = new Map();
	for (const text of lines) out.set(text, await speak(text, options));
	return out;
}

/** The premade and cloned voices this key can use — to pick a VOICE_ID. */
export async function listVoices() {
	const key = apiKey();
	if (!key) throw new Error('ElevenLabs: no key');
	const res = await fetch('https://api.elevenlabs.io/v1/voices', {
		headers: { 'xi-api-key': key }
	});
	const { voices } = await res.json();
	return voices.map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	// `node kit/voice.mjs voices` lists the voices; `node kit/voice.mjs "text"` speaks it.
	const [, , cmd, ...rest] = process.argv;
	if (cmd === 'voices') {
		for (const v of await listVoices())
			console.log(`${v.id}  ${v.name}  ${JSON.stringify(v.labels ?? {})}`);
	} else if (cmd) {
		const r = await speak(rest.length ? [cmd, ...rest].join(' ') : cmd);
		console.log(r ? `${r.file} (${r.durationMs} ms)` : 'no narrator (DEMO_VOICE)');
	}
}

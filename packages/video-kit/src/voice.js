// SPDX-License-Identifier: AGPL-3.0-or-later
// The narrator. Every line a scene says is spoken once by ElevenLabs and kept
// under its hash in the caller's voice folder, so a re-recording does not pay
// or wait for the same sentence twice. The scene waits for each line's length
// before it acts, which is what keeps the clicks on the voice.
//
// The key is read from the macOS keychain (a generic password, service
// "elevenlabs" unless the caller names another) or ELEVENLABS_API_KEY, never
// printed. Without a key, DEMO_VOICE=say uses macOS's own voice for a dry
// run, DEMO_VOICE=none records silence. Node only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** "George", one of ElevenLabs' premade voices: calm, British, reads a product. */
export const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
/**
 * Eleven v4: it reads IPA between slashes, which is how a name gets its own
 * sound from a voice of another language (multilingual_v2 has no such control).
 */
export const DEFAULT_MODEL = 'eleven_v4';

/**
 * @typedef {{ file: string, durationMs: number }} Spoken
 * @typedef {{
 *   provider: () => 'elevenlabs' | 'say' | 'none',
 *   speak: (text: string, o?: { lang?: string }) => Promise<Spoken | null>,
 *   prepare: (lines: string[], o?: { lang?: string }) => Promise<Map<string, Spoken | null>>,
 *   listVoices: () => Promise<{ id: string, name: string, labels: unknown }[]>,
 *   spoken: (text: string) => string
 * }} Voice
 */

/**
 * @param {{
 *   dir: string,
 *   pronounce?: Record<string, string>,
 *   keychainService?: string,
 *   voiceId?: string,
 *   model?: string,
 *   sayVoices?: Record<string, string>
 * }} options dir: where the spoken lines are kept (not in git: a minute of
 *   speech costs cents); pronounce: how the narrator says names, as IPA, used
 *   with the v3/v4 models (captions and subtitles keep the written word);
 *   sayVoices: macOS voices for a dry run, per language
 * @returns {Voice}
 */
export function createVoice({
	dir,
	pronounce = {},
	keychainService = 'elevenlabs',
	voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
	model = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL,
	sayVoices = { de: 'Anna', en: 'Daniel' }
}) {
	const ipaModel = /^eleven_v[34]/.test(model);
	const names = Object.keys(pronounce);
	const pattern = names.length ? new RegExp(`\\b(${names.join('|')})\\b`, 'g') : null;
	/** @param {string} text */
	const spoken = (text) =>
		ipaModel && pattern ? text.replace(pattern, (w) => pronounce[w]) : text;

	function apiKey() {
		if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
		try {
			return execFileSync('security', ['find-generic-password', '-s', keychainService, '-w'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();
		} catch {
			return '';
		}
	}

	/** @returns {'elevenlabs' | 'say' | 'none'} which narrator this run has */
	function provider() {
		const wanted = process.env.DEMO_VOICE;
		if (wanted === 'none' || wanted === 'say') return wanted;
		if (apiKey()) return 'elevenlabs';
		return wanted === 'elevenlabs' ? 'elevenlabs' : 'none';
	}

	/**
	 * The spoken file for a line, made if missing.
	 * @param {string} text
	 * @param {{ lang?: string }} [o]
	 */
	async function speak(text, { lang = 'en' } = {}) {
		const kind = provider();
		if (kind === 'none') return null;
		mkdirSync(dir, { recursive: true });
		const hash = createHash('sha256')
			.update(
				`${kind}:${kind === 'elevenlabs' ? `${model}:${voiceId}:${spoken(text)}` : `${lang}:${text}`}`
			)
			.digest('hex')
			.slice(0, 20);
		const file = resolve(dir, `${hash}.mp3`);
		if (!existsSync(file)) {
			if (kind === 'say') {
				const aiff = resolve(dir, `${hash}.aiff`);
				execFileSync('say', ['-v', sayVoices[lang] ?? sayVoices.en, '-o', aiff, text]);
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
					throw new Error(
						`ElevenLabs: no key (keychain service "${keychainService}" or ELEVENLABS_API_KEY)`
					);
				const res = await fetch(
					`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
					{
						method: 'POST',
						headers: {
							'xi-api-key': key,
							'content-type': 'application/json',
							accept: 'audio/mpeg'
						},
						body: JSON.stringify({
							text: spoken(text),
							model_id: model,
							// The v2 family takes the classic settings; v3/v4 read better on their own.
							voice_settings: ipaModel
								? undefined
								: {
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
				writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
			}
		}
		return { file, durationMs: durationMs(file) };
	}

	/**
	 * Make every line of a scene up front, so the recording never waits for the network.
	 * @param {string[]} lines
	 * @param {{ lang?: string }} [o]
	 */
	async function prepare(lines, o) {
		/** @type {Map<string, Spoken | null>} */
		const out = new Map();
		for (const text of lines) out.set(text, await speak(text, o));
		return out;
	}

	/** The premade and cloned voices this key can use — to pick a voice id. */
	async function listVoices() {
		const key = apiKey();
		if (!key) throw new Error('ElevenLabs: no key');
		const res = await fetch('https://api.elevenlabs.io/v1/voices', {
			headers: { 'xi-api-key': key }
		});
		const { voices } = await res.json();
		return voices.map((/** @type {any} */ v) => ({
			id: v.voice_id,
			name: v.name,
			labels: v.labels
		}));
	}

	return { provider, speak, prepare, listVoices, spoken };
}

/** @param {string} file */
export function durationMs(file) {
	const out = execFileSync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
		{ encoding: 'utf8' }
	);
	return Math.round(Number(out.trim()) * 1000);
}

/**
 * The command line of a voice: `voices` lists the voices, any other words are
 * spoken. In the caller's script: `await voiceCli(voice, process.argv.slice(2))`.
 * @param {Voice} voice
 * @param {string[]} args
 */
export async function voiceCli(voice, args) {
	const [cmd, ...rest] = args;
	if (cmd === 'voices') {
		for (const v of await voice.listVoices())
			console.log(`${v.id}  ${v.name}  ${JSON.stringify(v.labels ?? {})}`);
	} else if (cmd) {
		const r = await voice.speak([cmd, ...rest].join(' '));
		console.log(r ? `${r.file} (${r.durationMs} ms)` : 'no narrator (DEMO_VOICE)');
	}
}

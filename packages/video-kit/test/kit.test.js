// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCards, cardName, cuesToSrt } from '../src/index.js';
import { createVoice } from '../src/voice.js';
import { BRAND } from './support/brand.js';

const cards = createCards(BRAND);

test('a card is completed with its kind’s defaults, in the film’s language', () => {
	assert.deepEqual(cards.resolveCard({ card: 'intro' }, { lang: 'de' }), {
		title: 'Wolkenfabrik Demo',
		sub: 'Wolken nach Maß.',
		say: 'Wolkenfabrik. Wolken nach Maß.',
		hold: 5000,
		lang: 'de',
		card: 'intro'
	});
	const scene = cards.resolveCard({ card: 'scene', n: 3, title: 'Third' }, { lang: 'fr' });
	assert.equal(scene.eyebrow, 'Chapter 3', 'an unknown language falls back to en');
	assert.equal(scene.say, 'Third');
	assert.equal(cards.resolveCard({ card: 'scene', say: null }, { lang: 'en' }).say, null);
	assert.deepEqual(cards.resolveCard({ card: 'outro', say: null }, { lang: 'en' }).facts, [
		'made up',
		'for tests'
	]);
});

test('a card page is the brand’s: its mark, words, palette, address and QR, escaped text', () => {
	const intro = cards.cardHtml(cards.resolveCard({ card: 'intro' }, { lang: 'en' }));
	assert.match(intro, /<title>Wolkenfabrik Demo<\/title>/);
	assert.match(intro, /--night: #101010;.*--accent: #ff8800;/);
	assert.match(intro, /<rect class="box"/);
	assert.match(intro, /class="prefix">WOLKEN</);
	assert.doesNotMatch(intro, /@font-face/, 'no font given, none embedded');
	assert.doesNotMatch(intro, /transform:scale/, 'a 1080p frame is drawn as laid out');

	const outro = cards.cardHtml(cards.resolveCard({ card: 'outro' }, { lang: 'en' }), 2);
	assert.match(outro, />demo\.example\.com</);
	assert.match(outro, /<div class="panel rise"[^>]*><svg viewBox="0 0 1 1">/);
	assert.match(outro, /transform:scale\(2\)/);

	const scene = cards.cardHtml(
		cards.resolveCard({ card: 'scene', title: '<b>&', eyebrow: 'x"y' }, { lang: 'en' })
	);
	assert.match(scene, /<h1 class="rise"[^>]*>&lt;b&gt;&amp;<\/h1>/);
	assert.match(scene, />x&quot;y</);
	assert.match(
		scene,
		/\.scene \.box\{opacity:1;animation:none\}/,
		'the scene card’s mark is still'
	);

	const noQr = createCards({ ...BRAND, qr: null }).cardHtml(
		cards.resolveCard({ card: 'outro' }, { lang: 'en' })
	);
	assert.doesNotMatch(noQr, /class="panel/);
});

test('a card’s clip name is film, position and kind', () => {
	assert.equal(cardName('intro-de', 3, { card: 'scene' }), 'intro-de-03-scene');
});

test('a cue lasts its voice, at least 1.2 s, and never into the next', () => {
	assert.equal(
		cuesToSrt([
			{ t: 0, text: 'a', durationMs: 500 },
			{ t: 1000, text: 'b', durationMs: 4000 },
			{ t: 3000, text: 'c', durationMs: 2000 }
		]),
		'1\n00:00:00,000 --> 00:00:01,000\na\n\n2\n00:00:01,000 --> 00:00:03,000\nb\n\n3\n00:00:03,000 --> 00:00:05,000\nc\n'
	);
});

test('the narrator says names as written unless the model reads IPA', () => {
	const v4 = createVoice({
		dir: '/nonexistent',
		pronounce: { Fabrik: '/faˈbriːk/' },
		model: 'eleven_v4'
	});
	assert.equal(v4.spoken('Die Fabrik, nicht Fabriken.'), 'Die /faˈbriːk/, nicht Fabriken.');
	const v2 = createVoice({
		dir: '/nonexistent',
		pronounce: { Fabrik: '/faˈbriːk/' },
		model: 'eleven_multilingual_v2'
	});
	assert.equal(v2.spoken('Die Fabrik.'), 'Die Fabrik.');
	assert.equal(createVoice({ dir: '/nonexistent' }).spoken('Die Fabrik.'), 'Die Fabrik.');
});

test('without a narrator nothing is spoken and nothing is written', async () => {
	const before = process.env.DEMO_VOICE;
	process.env.DEMO_VOICE = 'none';
	try {
		const voice = createVoice({ dir: '/nonexistent/never-made' });
		assert.equal(voice.provider(), 'none');
		assert.equal(await voice.speak('Hello'), null);
	} finally {
		if (before === undefined) delete process.env.DEMO_VOICE;
		else process.env.DEMO_VOICE = before;
	}
});

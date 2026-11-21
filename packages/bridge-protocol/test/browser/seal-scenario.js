// SPDX-License-Identifier: AGPL-3.0-or-later
// A sealed call and its answer (seal.js): the same bytes in a browser as in
// Node for fixed values, and what does not open. seal.test.js runs it in
// both and compares. Made-up keys and arguments only.
import {
	SEALED,
	handoverSecret,
	isSealed,
	openCall,
	sealCall,
	sealedSize
} from '../../src/seal.js';
import { toBase64 } from '../../src/blocks.js';

/** @param {number} n @param {number} seed */
const made = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 29 + seed) & 0xff);

/** @param {() => Promise<unknown>} run */
async function refusal(run) {
	try {
		await run();
		return 'opened';
	} catch (error) {
		return /** @type {Error} */ (error).name;
	}
}

export default async function scenario() {
	const secret = made(32, 3);
	const context = {
		consumer: '12D3KooWdevice',
		provider: '12D3KooWbridge',
		command: 'mail.search'
	};
	const args = { text: 'Rechnung Übung', days: 14 };
	const fixed = { nonce: made(32, 11), iv: made(12, 5) };

	const call = await sealCall(secret, context, args, fixed);
	const opened = await openCall(secret, context, call.sent);
	const answer = { status: 200, contentType: 'application/json', json: { found: 2 } };
	const sealedAnswer = await opened.seal(answer, { iv: made(12, 9) });

	const other = { ...context, command: 'mail.messages' };
	const elsewhere = { ...context, provider: '12D3KooWother' };
	const twice = await sealCall(secret, context, args);
	const changed = { [SEALED]: call.sent[SEALED].replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };

	return {
		sent: call.sent[SEALED],
		answer: sealedAnswer[SEALED],
		args: opened.args,
		back: await call.open(sealedAnswer),
		sealed: isSealed(call.sent) && isSealed(sealedAnswer) && !isSealed(args) && !isSealed(null),
		fresh: twice.sent[SEALED] !== call.sent[SEALED],
		fits: JSON.stringify(call.sent).length <= sealedSize(JSON.stringify(args).length),
		plaintext: atob(call.sent[SEALED]).includes('Rechnung'),
		handover: toBase64(await handoverSecret(secret)),
		refused: {
			otherKey: await refusal(() => openCall(made(32, 4), context, call.sent)),
			otherCommand: await refusal(() => openCall(secret, other, call.sent)),
			otherPeer: await refusal(() => openCall(secret, elsewhere, call.sent)),
			changed: await refusal(() => openCall(secret, context, changed)),
			unsealed: await refusal(() => openCall(secret, context, args)),
			short: await refusal(() => openCall(secret, context, { [SEALED]: 'AAAA' })),
			// An answer opens for the call it answers only, and a call is no answer.
			otherCall: await refusal(() => twice.open(sealedAnswer)),
			callAsAnswer: await refusal(() => call.open(call.sent)),
			shortKey: await refusal(() => sealCall(made(16, 1), context, args)),
			noContext: await refusal(() => sealCall(secret, { ...context, command: 'a\nb' }, args))
		}
	};
}

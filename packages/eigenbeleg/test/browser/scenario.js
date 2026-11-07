// SPDX-License-Identifier: AGPL-3.0-or-later
// Every document this package draws, in a browser: the fonts come by fetch
// there, from disk in Node; browser.test.js compares the files byte for byte.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { samples } from '../support/samples.js';

export default async function scenario() {
	const { pdfs, csv } = await samples();
	return {
		pdfs: Object.fromEntries(
			Object.entries(pdfs).map(([name, bytes]) => [name, bytesToHex(sha256(bytes))])
		),
		csv: bytesToHex(sha256(utf8ToBytes(csv)))
	};
}

// The command table with nothing set up: every optional dependency null, so a
// test can see how a command is found, dispatched and answered without a
// single service behind it. Made-up config; nothing is called.
import { createCommands } from '../../src/commands.js';

export function emptyCommands() {
	return createCommands({
		config: /** @type {any} */ ({
			appOrigins: [],
			hibiscus: { ibanSuffixes: [] },
			mail: { accountingAddress: null, authServId: null },
			llm: { baseUrl: '', model: '', retryModel: '', redactTerms: [], redaction: 'on' }
		}),
		pairing: /** @type {any} */ ({ isPaired: () => false, hasPendingCode: () => false }),
		hibiscus: null,
		mail: null,
		llm: null,
		llmKeyPresent: async () => false,
		llmTee: null,
		assist: null,
		matchAssist: null,
		transferAssist: null,
		vendorAssist: null,
		shares: /** @type {any} */ ({ read: () => null, list: () => [], revoke: () => false }),
		rates: null,
		kraken: null,
		paperless: null,
		enablebanking: null,
		enablebankingLinks: null,
		wallets: null,
		aleph: null,
		alephLoopback: false,
		alephApi: 'https://api2.aleph.im',
		alephBackup: null,
		lanRelay: null,
		log: () => {}
	});
}

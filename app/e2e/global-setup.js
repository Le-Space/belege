import { startRelay } from './relay.js';

// The relay the UCEP spec reaches the invoicing app through (e2e/relay.js).
export default async function globalSetup() {
	const relay = await startRelay();
	return async () => {
		await relay.stop();
	};
}

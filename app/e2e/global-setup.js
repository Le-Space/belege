import { startRelay } from './relay.js';

// The relay the UCEP spec reaches the invoicing app through (e2e/relay.js).
// A benchmark run against an outside relay (BENCH_RELAY_ADDR) starts none.
export default async function globalSetup() {
	if (process.env.BENCH_RELAY_ADDR?.trim()) return async () => {};
	const relay = await startRelay();
	return async () => {
		await relay.stop();
	};
}

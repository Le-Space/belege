// @belege/chain-core: what every chain reader shares (#264) – JSON over
// HTTPS with errors that carry a code, amounts from units, explorer links,
// swap detection, and the neutral WalletEntry they all hand out.
export { WalletError, hostOf, checkEndpoint, createJsonFetcher } from './http.js';
export { unitsToDecimal } from './units.js';
export { txUrl, addressUrl } from './explorer.js';
export { markSwaps } from './swaps.js';

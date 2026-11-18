// A wallet offered from a payment ("Als eigene Wallet anlegen"): the chain and
// the address, handed to Integrationen → Eigene Wallets, which opens its form
// with them. In memory only, and taken once – never in the URL.

/** @type {{ value: { chain: string, address: string } | null }} */
const proposal = $state({ value: null });

/** @param {{ chain: string, address: string }} p */
export function proposeWallet(p) {
	proposal.value = { chain: p.chain, address: p.address };
}

/** The offer, once. @returns {{ chain: string, address: string } | null} */
export function takeWalletProposal() {
	const p = proposal.value;
	proposal.value = null;
	return p;
}

// A sign that the list of own wallets changed on this page: the wallets card
// counts it up when a wallet is added or removed, and a card next to it that
// shows something per wallet (Filecoin Pay) reads the list again.
export const walletList = $state({ changes: 0 });

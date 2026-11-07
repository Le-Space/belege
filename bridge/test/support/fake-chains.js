// Fake chain nodes on 127.0.0.1 for tests: they live with the readers in
// @le-space/chains – the Cosmos node and the Akash Console indexer
// (testing/cosmos), Blockscout (testing/blockscout) – and are re-exported
// here for `@belege/bridge/testing/chains`. Every address, hash and amount
// is made up.
export * from '@le-space/chains/testing/cosmos';
export * from '@le-space/chains/testing/blockscout';

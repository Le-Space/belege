# @belege/device-gate

Only the books' own devices get anything from a node of the books. Two modules, shared by the app's sync node and the bridge's node (Le-Space/belege#573):

- **`device-gate.js`** – the device proof as a libp2p service: `HMAC-SHA-256(deviceAuthKey, prover ‖ verifier)` over the peer ids Noise authenticated, offered to devices and never to a relay; until a peer proved it, every protocol handler and topology but identify, the relay's and the proof itself refuses it. `createDeviceGate({ authKey, admit, offer })`, `deviceProof`, `checkDeviceProof`, `isOpenProtocol`.
- **`quiet-identify.js`** – two identify lists: a relay or a stranger is told identify and the relay protocols only; a proved device the rest. OrbitDB's per-database protocols and `/belege/*` are never announced. `quietIdentify`, `quietIdentifyPush`, `gatedIdentify`, `NODE_INFO`.

The tests live with the app (`app/src/lib/sync/*.spec.js`), which exercises both on real libp2p nodes. The threat model is in [docs/device-proof.md](../../docs/device-proof.md).

// Ported from Le-Space/simple-todo packages/todo (src/restored-signing-key.js) at 56647d5.
// Changed: nothing but this header. belege also uses seedRestoredSigningKey for
// a freshly created passkey, see node.js.
//
/**
 * A passkey restored on this device brings its OrbitDB signing key with it.
 *
 * `restoreIdentityFromAuthenticator()` reads the passkey's PRF output in its
 * first touch and derives the signing key from it. The provider, left to
 * itself, derives that same key again when OrbitDB asks for the identity — and
 * to do so it asks the passkey for the PRF output once more: a touch that
 * yields nothing new. Put into the keystore first, the key is simply there
 * (`ensureDerivedSigningKey` finds it and leaves it alone), and a restore
 * costs three touches instead of four: two to restore, one to sign the
 * identity.
 *
 * The chapters carry the key on the credential as a non-enumerable property,
 * so no serialiser writes it down: `storeWebAuthnCredential` spreads the
 * credential, and a spread copies only what is enumerable.
 */

/**
 * @param {{ getKey: (id: string) => Promise<unknown>, addKey: (id: string, key: { privateKey: Uint8Array }) => Promise<unknown> } | null | undefined} keystore
 * @param {{ did?: string, signingKey?: Uint8Array } | null | undefined} credential
 * @returns {Promise<boolean>} whether the key was added
 */
export async function seedRestoredSigningKey(keystore, credential) {
	const privateKey = credential?.signingKey;
	if (!keystore || !credential?.did || !(privateKey instanceof Uint8Array)) return false;
	// A key already there has a history (a keep-mode keystore from an earlier
	// visit); replacing it would mint a second identity document for the DID.
	if (await keystore.getKey(credential.did)) return false;
	await keystore.addKey(credential.did, { privateKey });
	return true;
}

/**
 * Attach a restored signing key so it travels with the credential in memory
 * only.
 *
 * @template {object} T
 * @param {T} credential
 * @param {Uint8Array | undefined} signingKey
 * @returns {T}
 */
export function withRestoredSigningKey(credential, signingKey) {
	if (signingKey instanceof Uint8Array) {
		Object.defineProperty(credential, 'signingKey', { value: signingKey, enumerable: false });
	}
	return credential;
}

// Settings: small records in the sealed `settings` collection, one per key.
// The bridge token lives here, never in localStorage.

/**
 * @param {import('./repository.js').Collection} settings
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(settings, key) {
	const [record] = await settings.list({ where: (r) => r.key === key });
	return record?.value ?? null;
}

/**
 * @param {import('./repository.js').Collection} settings
 * @param {string} key
 * @param {unknown} value `null` clears it
 */
export async function setSetting(settings, key, value) {
	const [record] = await settings.list({ where: (r) => r.key === key });
	return settings.put({ ...(record ?? {}), key, value });
}

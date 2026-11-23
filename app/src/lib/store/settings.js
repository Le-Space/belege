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

/**
 * A setting's newest value as `writer` wrote it: the settings log walked
 * newest first, entries by anyone else – a member – passed over. Null when
 * that writer never wrote it, or cleared it.
 *
 * @param {any} db the settings database (OrbitDB)
 * @param {string} key the setting
 * @param {string} writer an identity id: the books' own (#627)
 */
export async function settingWrittenBy(db, key, writer) {
	for await (const entry of db.log.iterator()) {
		const record = entry.payload?.value;
		if (entry.payload?.op !== 'PUT' || record?.key !== key) continue;
		if ((await db.access.writerOf(entry)) !== writer) continue;
		return record.deleted ? null : (record.value ?? null);
	}
	return null;
}

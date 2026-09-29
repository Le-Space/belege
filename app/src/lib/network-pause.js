// "Alles pausieren" in the header's network menu, kept per browser like the
// device-sync switch (sync/device-sync.js): while set, Belege goes online for
// nothing – not at the next unlock either – until the person resumes. It
// remembers whether the invoicing app was connected, to connect it again.

export const PAUSE_KEY = 'belege.network-paused';

/** @returns {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} */
function storage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** The pause, or null when the network is not paused. @returns {{ ucep: boolean, at: string } | null} */
export function networkPause() {
	try {
		const raw = storage()?.getItem(PAUSE_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw);
		return { ucep: Boolean(v?.ucep), at: String(v?.at ?? '') };
	} catch {
		return null;
	}
}

/** @param {{ ucep: boolean } | null} pause null resumes */
export function setNetworkPause(pause, now = () => new Date()) {
	try {
		if (pause)
			storage()?.setItem(PAUSE_KEY, JSON.stringify({ ucep: pause.ucep, at: now().toISOString() }));
		else storage()?.removeItem(PAUSE_KEY);
	} catch {
		// A browser that keeps nothing: the pause lasts as long as the page.
	}
}

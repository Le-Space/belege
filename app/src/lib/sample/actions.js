// Sample books in and out of the open books (issue #200, step 3), with the
// matching run over them so questions and links are there to look at.
import { currentStore, runMatchingNow } from '$lib/session.svelte.js';
import { addSample, removeSample } from './sample.js';

/** Today in local time, YYYY-MM-DD. */
const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function loadSampleData() {
	const store = currentStore();
	if (!store) return;
	await addSample(store, today());
	await runMatchingNow();
}

export async function clearSampleData() {
	const store = currentStore();
	if (!store) return;
	await removeSample(store);
	await runMatchingNow();
}

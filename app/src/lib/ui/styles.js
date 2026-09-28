// One pattern for the cards (issue #152): one primary action per card, the
// rest secondary or a link; every control at least 44 px high.
export const btn = {
	primary:
		'min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50',
	secondary:
		'min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
	link: 'min-h-11 text-sm text-text underline hover:text-heading'
};
export const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';

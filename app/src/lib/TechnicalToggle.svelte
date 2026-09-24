<script>
	// Ported from Le-Space/simple-todo apps/escrow01 (src/lib/TechnicalToggle.svelte) at f0d3df4.
	// Changed: runes, and the catalogue.
	//
	// The switch between the simple and the technical view. One component for
	// both places it sits, the consent dialog and the page header, so the two
	// read the same and switch the same page-wide setting.
	import { t } from './i18n/index.js';
	import { technicalView } from './technical-view.js';

	/** @type {{ testid?: string }} */
	let { testid = 'technical-toggle' } = $props();
</script>

<!-- Named after the view it switches to. -->
<button
	type="button"
	onclick={() => technicalView.toggle()}
	data-testid={testid}
	data-technical={$technicalView}
	title={t('technical.title')}
	class="rounded-md border border-border px-2 py-1 text-xs text-faint hover:text-text"
>
	{$technicalView ? t('technical.on') : t('technical.off')}
</button>

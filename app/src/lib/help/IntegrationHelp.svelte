<script>
	// "?" on an integration's page (issue #200, step 4): what it is and how to
	// set it up, in two or three sentences, with the terminal command to copy
	// and a link into the docs. Unfolded while the integration is not set up.
	import CopyButton from '$lib/CopyButton.svelte';
	import { currentLocale, t } from '$lib/i18n/index.js';
	import { INTEGRATION_HELP, helpDoc } from './integration-help.js';

	/** @type {{ id: string, open?: boolean, hosted?: boolean }} `hosted`: a hosted bridge answers – no terminal there */
	let { id, open = false, hosted = false } = $props();
	// Where setting up differs on a hosted bridge, the catalogue has `howHosted`.
	const HOSTED_HOW = ['ki'];
	let hostedHelp = $derived(hosted && HOSTED_HOW.includes(id));

	let help = $derived(INTEGRATION_HELP[id]);
	let doc = $derived(helpDoc(id, currentLocale()));
</script>

{#if help}
	<details
		class="mt-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm"
		{open}
		data-testid="integration-help"
	>
		<summary class="flex min-h-11 cursor-pointer items-center gap-2 text-text">
			<span
				aria-hidden="true"
				class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs font-semibold"
				>?</span
			>
			{t('integrationen.help.title')}
		</summary>
		<div class="space-y-2 pb-2">
			<p class="text-text">{t(`integrationen.help.${id}.what`)}</p>
			<p class="text-text" data-testid="integration-help-how">
				{t(`integrationen.help.${id}.${hostedHelp ? 'howHosted' : 'how'}`)}
			</p>
			{#if help.command && !hostedHelp}
				<p class="text-text">
					{t('integrationen.help.command')}
					<CopyButton
						text={help.command}
						label={t('help.copyCommand')}
						testid="integration-help-command"
						valueClass="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-heading"
						>{help.command}</CopyButton
					>
				</p>
			{/if}
			{#if doc}
				<a
					class="inline-block text-text underline hover:text-heading"
					href={doc}
					rel="noreferrer"
					data-testid="integration-help-doc">{t('integrationen.help.doc')}</a
				>
			{/if}
		</div>
	</details>
{/if}

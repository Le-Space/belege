<script>
	// The setup checklist (issue #200): on Home until nothing is open, and
	// under Einstellungen for good. The next open step is unfolded with why it
	// matters and "Jetzt" / "Später"; the bridge step guides in place
	// (BridgeGuide). Done is what the books and the bridge say (steps.js).
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import { loadIntegrationFacts } from '$lib/integrations/facts.svelte.js';
	import BridgeGuide from './BridgeGuide.svelte';
	import { currentSetup, loadSetup, setLater, setup } from './setup-state.svelte.js';

	/** @type {{ place?: 'home' | 'settings' }} */
	let { place = 'home' } = $props();

	onMount(() => {
		loadSetup();
		loadIntegrationFacts();
	});

	let list = $derived(currentSetup());
	/** @type {string | null} the step unfolded by a click */
	let chosen = $state(null);
	let unfolded = $derived(
		chosen && list.steps.some((s) => s.id === chosen && s.state === 'open')
			? chosen
			: (list.next?.id ?? null)
	);
	let open = $derived(list.steps.filter((s) => s.state !== 'later'));
	let later = $derived(list.steps.filter((s) => s.state === 'later'));
	let shown = $derived(setup.loaded && (place === 'settings' || !list.finished));

	/** @param {string} href */
	const go = (href) => resolve(/** @type {any} */ (href));

	const CHIP = {
		done: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
		open: 'bg-surface-2 text-text',
		later: 'bg-surface-2 text-faint'
	};
	const primary =
		'inline-flex min-h-11 items-center rounded-md bg-cyan-800 px-3 text-sm font-medium text-white hover:bg-cyan-900 dark:bg-cyan dark:text-bg';
	const secondary =
		'inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading';
</script>

{#if shown}
	<section
		class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 sm:px-5"
		aria-labelledby="setup-{place}-h"
		data-testid="setup-{place}"
	>
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 id="setup-{place}-h" class="text-base font-semibold text-heading">
				{t('setup.title')}
			</h2>
			<span class="text-sm text-faint" data-testid="setup-progress"
				>{t('setup.progress', { done: list.done, total: list.total })}</span
			>
		</div>
		<div
			class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
			role="progressbar"
			aria-valuemin="0"
			aria-valuemax={list.total}
			aria-valuenow={list.done}
			aria-label={t('setup.title')}
		>
			<div
				class="h-full bg-cyan-700 dark:bg-cyan"
				style="width: {Math.round((100 * list.done) / Math.max(list.total, 1))}%"
			></div>
		</div>
		<p class="mt-2 text-sm text-text">
			{list.finished ? t('setup.finished') : t('setup.intro')}
		</p>
		{#if place === 'settings'}<p class="mt-1 text-xs text-faint">{t('setup.settingsHint')}</p>{/if}

		<ol class="mt-2 divide-y divide-border">
			{#each open as step (step.id)}
				<li class="py-2" data-testid="setup-step" data-step={step.id} data-state={step.state}>
					<button
						type="button"
						class="flex min-h-11 w-full flex-wrap items-center gap-2 text-left"
						aria-expanded={unfolded === step.id}
						disabled={step.state === 'done'}
						onclick={() => (chosen = unfolded === step.id ? null : step.id)}
					>
						<span class="rounded-full px-2 py-0.5 text-xs font-semibold {CHIP[step.state]}"
							>{step.state === 'done' ? '✓ ' : ''}{t(`setup.state.${step.state}`)}</span
						>
						<span
							class="font-medium {step.state === 'done'
								? 'text-faint line-through'
								: 'text-heading'}">{t(`setup.step.${step.id}.title`)}</span
						>
						{#if step.optional}<span class="text-xs text-faint">{t('setup.optional')}</span>{/if}
						{#if step.state === 'open'}
							{#each step.needs as need (need)}
								<span class="rounded border border-border px-1.5 text-xs text-faint"
									>{t(`setup.needs.${need}`)}</span
								>
							{/each}
						{/if}
					</button>
					{#if unfolded === step.id && step.state === 'open'}
						<div class="pb-1 pl-1" data-testid="setup-step-detail">
							<p class="text-sm text-text">{t(`setup.step.${step.id}.why`)}</p>
							<p class="mt-1 text-xs text-faint">{t(`setup.step.${step.id}.time`)}</p>
							{#if step.id === 'bridge'}
								<BridgeGuide />
							{/if}
							<div class="mt-2 flex flex-wrap gap-2">
								{#if step.id !== 'bridge'}
									<a class={primary} href={go(step.href)} data-testid="setup-now"
										>{t('setup.now')}</a
									>
								{/if}
								<button
									type="button"
									class={secondary}
									onclick={() => setLater(step.id, true)}
									data-testid="setup-later">{t('setup.later')}</button
								>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ol>

		{#if later.length}
			<details class="mt-2 text-sm" data-testid="setup-later-list">
				<summary class="min-h-11 cursor-pointer py-2 text-text"
					>{t('setup.laterTitle', { count: later.length })}</summary
				>
				<ul class="divide-y divide-border">
					{#each later as step (step.id)}
						<li
							class="flex min-h-11 items-center justify-between gap-2 py-1"
							data-testid="setup-step"
							data-step={step.id}
							data-state="later"
						>
							<span class="text-text">{t(`setup.step.${step.id}.title`)}</span>
							<button
								type="button"
								class={secondary}
								onclick={() => setLater(step.id, false)}
								data-testid="setup-resume">{t('setup.resume')}</button
							>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>
{/if}

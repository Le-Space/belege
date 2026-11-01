<script>
	// "Reisende" under Einstellungen (issue #380): who travels – the owner or
	// managing shareholder and employees – each with the clearing account their
	// statements are booked on (an employee's is required: nothing is booked
	// without it) and the last digits of their IBAN, which recognise a payout.
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { ownerTraveller, removeTraveller, saveTraveller, travellersOf } from './records.js';

	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';

	let travellers = $derived(travellersOf(app.travel));
	let hasOwner = $derived(travellers.some((p) => p.role === 'owner'));

	/** @type {Record<string, any> | null} the one being added or changed */
	let draft = $state(null);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	function add() {
		draft = { role: 'employee', name: '', clearingAccount: '', ibanLast4: '' };
		error = null;
	}
	/** @param {Record<string, any>} p */
	function edit(p) {
		draft = {
			id: p.id,
			role: p.role,
			name: p.name ?? '',
			clearingAccount: p.clearingAccount ?? '',
			ibanLast4: p.ibanLast4 ?? ''
		};
		error = null;
	}

	/** @param {() => Promise<unknown>} fn */
	async function run(fn) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await fn();
			await refreshNow();
		} catch (e) {
			const code = /** @type {any} */ (e)?.code;
			error =
				code === 'inUse'
					? t('travellers.inUse')
					: code === 'owner'
						? t('travellers.ownerExists')
						: e instanceof Error
							? e.message
							: String(e);
		} finally {
			busy = false;
		}
	}

	const save = () =>
		run(async () => {
			const store = /** @type {any} */ (currentStore());
			// The owner travels too: made with the first employee, so trips can be told apart.
			if (!hasOwner && draft?.role !== 'owner')
				await ownerTraveller(store, cleanDatevSettings(app.datevSettings));
			await saveTraveller(
				/** @type {any} */ (currentStore()),
				/** @type {Record<string, any>} */ ($state.snapshot(draft))
			);
			draft = null;
		});
	/** @param {Record<string, any>} p */
	const remove = (p) =>
		run(async () => {
			await removeTraveller(/** @type {any} */ (currentStore()), String(p.id));
			if (draft?.id === p.id) draft = null;
		});

	/** @param {Record<string, any>} p */
	const missingAccount = (p) => p.role === 'employee' && !String(p.clearingAccount ?? '').trim();
</script>

<section
	class="rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="travellers-h"
	data-testid="travellers-card"
>
	<h2 id="travellers-h" class="text-lg font-semibold text-heading">{t('travellers.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('travellers.intro')}</p>

	{#if travellers.length}
		<ul class="mt-3 divide-y divide-border text-sm">
			{#each travellers as p (p.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="traveller">
					<span class="font-medium text-heading">{p.name || t('travellers.unnamed')}</span>
					<span class="text-xs text-faint">{t(`travellers.role.${p.role}`)}</span>
					<span class="font-mono text-xs text-text"
						>{p.clearingAccount
							? t('travellers.accountShown', { account: p.clearingAccount })
							: ''}{p.ibanLast4 ? ` · ···${p.ibanLast4}` : ''}</span
					>
					{#if missingAccount(p)}
						<span class="text-xs text-danger" data-testid="traveller-no-account"
							>{t('travellers.noAccount')}</span
						>
					{/if}
					<span class="ml-auto flex gap-3">
						<button
							type="button"
							class={btn.link}
							onclick={() => edit(p)}
							data-testid="traveller-edit">{t('travellers.edit')}</button
						>
						{#if p.role !== 'owner'}
							<button
								type="button"
								class={btn.link}
								onclick={() => remove(p)}
								disabled={busy}
								data-testid="traveller-remove">{t('travellers.remove')}</button
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-3 text-sm text-faint">{t('travellers.none')}</p>
	{/if}

	{#if draft}
		<form
			class="mt-3 grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
			data-testid="traveller-form"
		>
			<label class="flex flex-col text-sm text-text"
				>{t('travellers.name')}
				<input class={field} bind:value={draft.name} required data-testid="traveller-name" />
			</label>
			<label class="flex flex-col text-sm text-text"
				>{t('travellers.roleLabel')}
				<select class={field} bind:value={draft.role} data-testid="traveller-role">
					<option value="employee">{t('travellers.role.employee')}</option>
					<option value="owner" disabled={hasOwner && draft.role !== 'owner'}
						>{t('travellers.role.owner')}</option
					>
				</select>
			</label>
			<label class="flex flex-col text-sm text-text"
				>{t('travellers.account')}
				<input
					class="font-mono {field}"
					inputmode="numeric"
					bind:value={draft.clearingAccount}
					required={draft.role === 'employee'}
					data-testid="traveller-account"
				/>
				<span class="mt-1 text-xs text-faint"
					>{t(
						draft.role === 'employee' ? 'travellers.accountHint' : 'travellers.accountHintOwner'
					)}</span
				>
			</label>
			<label class="flex flex-col text-sm text-text"
				>{t('travellers.iban')}
				<input
					class="w-24 font-mono {field}"
					inputmode="numeric"
					maxlength="4"
					bind:value={draft.ibanLast4}
					data-testid="traveller-iban"
				/>
				<span class="mt-1 text-xs text-faint">{t('travellers.ibanHint')}</span>
			</label>
			<div class="flex gap-2 sm:col-span-2">
				<button type="submit" class={btn.primary} disabled={busy} data-testid="traveller-save"
					>{t('travellers.save')}</button
				>
				<button type="button" class={btn.secondary} onclick={() => (draft = null)}
					>{t('travellers.cancel')}</button
				>
			</div>
		</form>
	{:else}
		<button type="button" class="mt-3 {btn.secondary}" onclick={add} data-testid="traveller-add"
			>{t('travellers.add')}</button
		>
	{/if}
	{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
	<p class="mt-3 text-xs text-faint">{t('travellers.adviser')}</p>
</section>

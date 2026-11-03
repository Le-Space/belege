<script>
	// "Zusammenarbeit" (#611): the members of these books, admitting one by
	// their join code, and – on the bookkeeping's device – making a join code
	// and taking the answer. Nothing here goes over the network: the two texts
	// travel however the people like; the answer opens on the joining device only.
	import { onMount } from 'svelte';
	import { btn, card } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import {
		admitMember,
		cancelJoining,
		currentStore,
		finishJoining,
		startJoining
	} from '$lib/session.svelte.js';
	import { membersOf } from './members.js';

	/** @type {import('./members.js').Member[]} */
	let members = $state([]);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Admitting (the owner).
	let admitName = $state('');
	let booksName = $state('');
	let code = $state('');
	/** @type {{ answer: string, fingerprint: string } | null} */
	let admitted = $state(null);

	// Joining (the bookkeeping).
	let joinName = $state('');
	/** @type {{ text: string, fingerprint: string } | null} */
	let joinCode = $state(null);
	let answer = $state('');
	/** @type {string | null} */
	let joinedBooks = $state(null);

	async function load() {
		const store = currentStore();
		if (!store) return;
		members = membersOf(await store.settings.list({ includeDeleted: true })).filter(
			(m) => !m.removed
		);
	}
	onMount(() => {
		load();
		return () => cancelJoining();
	});

	/** @param {() => Promise<void>} fn */
	async function run(fn) {
		busy = true;
		error = null;
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const admit = () =>
		run(async () => {
			admitted = await admitMember({ code, label: admitName, booksLabel: booksName });
			code = '';
			await load();
		});
	const makeCode = () => run(async () => void (joinCode = await startJoining(joinName)));
	const join = () =>
		run(async () => {
			joinedBooks = (await finishJoining(answer)).books;
			joinCode = null;
			answer = '';
		});
</script>

<section class={card} aria-labelledby="members-h" data-testid="members-card">
	<h2 id="members-h" class="text-lg font-semibold">{t('members.title')}</h2>
	<p class="mt-2 text-sm text-text">{t('members.intro')}</p>

	<h3 class="mt-4 text-sm font-semibold text-heading">{t('members.list')}</h3>
	{#if members.length}
		<ul class="mt-1 divide-y divide-border text-sm" data-testid="members">
			{#each members as m (m.writer)}
				<li class="py-2" data-testid="member">
					<span class="text-heading">{m.label}</span>
					<span class="text-faint"> · {t(`members.role.${m.role}`)}</span>
					<span class="block font-mono text-xs break-all text-faint">{m.writer}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-1 text-sm text-faint" data-testid="members-none">{t('members.none')}</p>
	{/if}

	<form
		class="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm"
		onsubmit={(e) => {
			e.preventDefault();
			admit();
		}}
		data-testid="member-admit"
	>
		<h3 class="font-semibold text-heading">{t('members.admit.title')}</h3>
		<p class="text-xs text-faint">{t('members.admit.hint')}</p>
		<label class="flex flex-col"
			>{t('members.admit.name')}
			<input
				class="mt-1 rounded-md border px-2 py-1"
				bind:value={admitName}
				maxlength="60"
				data-testid="member-admit-name"
			/></label
		>
		<label class="flex flex-col"
			>{t('members.admit.books')}
			<input
				class="mt-1 rounded-md border px-2 py-1"
				bind:value={booksName}
				maxlength="80"
				data-testid="member-admit-books"
			/></label
		>
		<label class="flex flex-col"
			>{t('members.admit.code')}
			<textarea
				class="mt-1 rounded-md border px-2 py-1 font-mono text-xs"
				rows="3"
				bind:value={code}
				data-testid="member-admit-code"
			></textarea></label
		>
		<button
			type="submit"
			class="self-start {btn.primary}"
			disabled={busy || !code.trim()}
			data-testid="member-admit-button">{t('members.admit.button')}</button
		>
		{#if admitted}
			<div class="mt-2" role="status" data-testid="member-admitted">
				<p class="text-xs text-text">
					{t('members.admit.check', { fingerprint: admitted.fingerprint })}
				</p>
				<p class="mt-2 font-medium text-heading">{t('members.admit.answer')}</p>
				<textarea
					class="mt-1 w-full rounded-md border px-2 py-1 font-mono text-xs"
					rows="4"
					readonly
					value={admitted.answer}
					data-testid="member-answer"
				></textarea>
				<CopyButton
					text={admitted.answer}
					label={t('members.admit.answer')}
					testid="member-answer-copy">{t('members.admit.answer')}</CopyButton
				>
				<p class="mt-1 text-xs text-faint">{t('members.admit.answerHint')}</p>
			</div>
		{/if}
	</form>

	<div
		class="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm"
		data-testid="member-join"
	>
		<h3 class="font-semibold text-heading">{t('members.join.title')}</h3>
		<p class="text-xs text-faint">{t('members.join.hint')}</p>
		{#if joinedBooks}
			<p class="text-success" role="status" data-testid="member-joined">
				{t('members.join.done', { books: joinedBooks })}
			</p>
		{:else if !joinCode}
			<label class="flex flex-col"
				>{t('members.join.name')}
				<input
					class="mt-1 rounded-md border px-2 py-1"
					bind:value={joinName}
					maxlength="60"
					data-testid="member-join-name"
				/></label
			>
			<button
				type="button"
				class="self-start {btn.secondary}"
				disabled={busy}
				onclick={makeCode}
				data-testid="member-join-button">{t('members.join.button')}</button
			>
		{:else}
			<p class="font-medium text-heading">{t('members.join.code')}</p>
			<textarea
				class="w-full rounded-md border px-2 py-1 font-mono text-xs"
				rows="3"
				readonly
				value={joinCode.text}
				data-testid="member-join-code"
			></textarea>
			<p class="text-xs text-text" data-testid="member-join-check">
				{t('members.join.check', { fingerprint: joinCode.fingerprint })}
			</p>
			<label class="flex flex-col"
				>{t('members.join.answer')}
				<textarea
					class="mt-1 rounded-md border px-2 py-1 font-mono text-xs"
					rows="3"
					bind:value={answer}
					data-testid="member-join-answer"
				></textarea></label
			>
			<div class="flex gap-3">
				<button
					type="button"
					class={btn.primary}
					disabled={busy || !answer.trim()}
					onclick={join}
					data-testid="member-join-finish">{t('members.join.finish')}</button
				>
				<button
					type="button"
					class={btn.link}
					onclick={() => {
						cancelJoining();
						joinCode = null;
					}}
					data-testid="member-join-cancel">{t('members.join.cancel')}</button
				>
			</div>
		{/if}
	</div>

	{#if error}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="members-error">{error}</p>
	{/if}
</section>

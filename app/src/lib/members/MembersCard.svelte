<script>
	// "Zusammenarbeit" (#611): the members of these books, admitting one by
	// their join code, and – on the bookkeeping's device – making a join code
	// and taking the answer. Nothing here goes over the network: the two texts
	// travel however the people like; the answer opens on the joining device only.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { btn, card } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import {
		admitMember,
		app,
		cancelJoining,
		currentStore,
		finishJoining,
		readJoinAnswer,
		readJoinCode,
		removeMember,
		startJoining
	} from '$lib/session.svelte.js';
	import { intlLocale } from '$lib/i18n/index.js';
	import { membersOf } from './members.js';

	/** @type {import('./members.js').Member[]} */
	let members = $state([]);
	/** @type {import('./members.js').Member[]} taken out (#614) */
	let removed = $state([]);
	/** The member whose "Herausnehmen" asks first. */
	let removing = $state('');
	/** Just taken out: new keys are offered (#627), and what was put back is said. */
	let removedNow = $state(false);
	/** @type {{ reset: string[], changed: string[] } | null} */
	let removal = $state(null);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Admitting (the owner).
	let admitName = $state('');
	let booksName = $state('');
	let code = $state('');
	/** @type {{ answer: string, fingerprint: string, books: string } | null} */
	let admitted = $state(null);
	/** The code read, nothing written yet: compared on both screens first. */
	/** @type {{ fingerprint: string, label: string } | null} */
	let codeRead = $state(null);
	let codeMatches = $state(false);

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
		const all = membersOf(await store.settings.list({ includeDeleted: true }));
		members = all.filter((m) => !m.removed);
		removed = all.filter((m) => m.removed);
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

	const readCode = () =>
		run(async () => {
			codeRead = await readJoinCode(code);
			codeMatches = false;
			if (!admitName.trim()) admitName = codeRead.label;
		});
	const admit = () =>
		run(async () => {
			admitted = await admitMember({ code, label: admitName, booksLabel: booksName });
			code = '';
			codeRead = null;
			codeMatches = false;
			await load();
		});
	/** The answer read, nothing kept yet: the books' fingerprint compared first. */
	/** @type {{ books: string, fingerprint: string } | null} */
	let answerRead = $state(null);
	let answerMatches = $state(false);
	const readAnswer = () =>
		run(async () => {
			answerRead = await readJoinAnswer(answer);
			answerMatches = false;
		});
	/** @param {string} writer */
	const takeOut = (writer) =>
		run(async () => {
			removal = await removeMember(writer);
			removing = '';
			removedNow = true;
			await load();
		});
	/** @param {string} iso */
	const day = (iso) =>
		iso ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(iso)) : '';
	const makeCode = () => run(async () => void (joinCode = await startJoining(joinName)));
	const join = () =>
		run(async () => {
			joinedBooks = (await finishJoining(answer)).books;
			joinCode = null;
			answer = '';
			answerRead = null;
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
					<span class="text-faint" data-testid="member-devices">
						· {t('members.devices', { count: m.devices.length })}</span
					>
					<span class="block text-xs text-faint">{t('members.since', { day: day(m.at) })}</span>
					<span class="block font-mono text-xs break-all text-faint">{m.writer}</span>
					{#if !app.member}
						{#if removing === m.writer}
							<div
								class="mt-2 rounded-md border border-border p-2 text-xs"
								role="alertdialog"
								aria-labelledby="member-remove-h"
								data-testid="member-remove-confirm"
							>
								<p id="member-remove-h" class="font-medium text-heading">
									{t('members.remove.title', { name: m.label })}
								</p>
								<ul class="mt-1 list-disc pl-4 text-text">
									<li>{t('members.remove.writes')}</li>
									<li>{t('members.remove.devices')}</li>
									<li>{t('members.remove.stays')}</li>
								</ul>
								<div class="mt-2 flex gap-3">
									<button
										type="button"
										class={btn.secondary}
										disabled={busy}
										onclick={() => takeOut(m.writer)}
										data-testid="member-remove-yes">{t('members.remove.yes')}</button
									>
									<button
										type="button"
										class={btn.link}
										onclick={() => (removing = '')}
										data-testid="member-remove-no">{t('members.remove.no')}</button
									>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="mt-1 text-xs text-link underline"
								onclick={() => (removing = m.writer)}
								data-testid="member-remove">{t('members.remove.button')}</button
							>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-1 text-sm text-faint" data-testid="members-none">{t('members.none')}</p>
	{/if}
	{#if removedNow}
		<p class="mt-2 text-sm text-text" role="status" data-testid="member-removed-next">
			{#if removal?.reset.length}
				<span class="block" data-testid="member-removed-reset"
					>{t('members.remove.reset', { keys: removal.reset.join(', ') })}</span
				>
			{/if}
			{#if removal?.changed.length}
				<span class="block" data-testid="member-removed-changed"
					>{t('members.remove.changed', { keys: removal.changed.join(', ') })}</span
				>
			{/if}
			{t('settings.keys.rekey.afterRemoval')}
			<a
				class="text-link underline"
				href={`${resolve('/einstellungen')}#rekey`}
				data-testid="member-rekey-link">{t('settings.keys.rekey.title')}</a
			>
		</p>
	{/if}
	{#if removed.length}
		<details class="mt-2 text-sm" data-testid="members-removed">
			<summary class="cursor-pointer text-faint"
				>{t('members.removedList', { count: removed.length })}</summary
			>
			<ul class="mt-1 divide-y divide-border">
				{#each removed as m (m.writer)}
					<li class="py-1 text-faint" data-testid="member-removed">
						{m.label} · {t('members.removedOn', { day: day(m.removedAt ?? '') })}
					</li>
				{/each}
			</ul>
		</details>
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
				oninput={() => {
					codeRead = null;
					codeMatches = false;
				}}
				data-testid="member-admit-code"
			></textarea></label
		>
		{#if !codeRead}
			<button
				type="button"
				class="self-start {btn.secondary}"
				disabled={busy || !code.trim()}
				onclick={readCode}
				data-testid="member-admit-read">{t('members.admit.read')}</button
			>
		{:else}
			<p class="text-xs text-text" data-testid="member-admit-preview">
				{t('members.admit.compare', { fingerprint: codeRead.fingerprint })}
			</p>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={codeMatches} data-testid="member-admit-match" />
				{t('members.admit.matches')}
			</label>
			<button
				type="submit"
				class="self-start {btn.primary}"
				disabled={busy || !codeMatches}
				data-testid="member-admit-button">{t('members.admit.button')}</button
			>
		{/if}
		{#if admitted}
			<div class="mt-2" role="status" data-testid="member-admitted">
				<p class="text-xs text-text" data-testid="member-admit-books-check">
					{t('members.admit.booksCheck', { fingerprint: admitted.books })}
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
					oninput={() => {
						answerRead = null;
						answerMatches = false;
					}}
					data-testid="member-join-answer"
				></textarea></label
			>
			{#if answerRead}
				<p class="text-xs text-text" data-testid="member-join-books">
					{t('members.join.booksCompare', {
						books: answerRead.books,
						fingerprint: answerRead.fingerprint
					})}
				</p>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={answerMatches} data-testid="member-join-match" />
					{t('members.join.matches')}
				</label>
			{/if}
			<div class="flex gap-3">
				{#if !answerRead}
					<button
						type="button"
						class={btn.secondary}
						disabled={busy || !answer.trim()}
						onclick={readAnswer}
						data-testid="member-join-read">{t('members.join.read')}</button
					>
				{:else}
					<button
						type="button"
						class={btn.primary}
						disabled={busy || !answerMatches}
						onclick={join}
						data-testid="member-join-finish">{t('members.join.finish')}</button
					>
				{/if}
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

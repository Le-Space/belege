<script>
	// "Einstellungen für die gehostete Bridge" (#728): what a hosted bridge –
	// on Aleph or on Phala through NEAR – starts with besides its pairing.
	// Taken over from the bridge on this computer, or typed in here; kept
	// sealed in the books and handed only to an attested VM at its start.
	// Values are never shown again, only which accounts and settings are kept.
	import { t } from '$lib/i18n/index.js';
	import {
		app,
		forgetHostedSettings,
		hostedSettingsNames,
		hostedSettingsView,
		keepHostedSettings,
		takeOverBridgeSettings
	} from '$lib/session.svelte.js';
	import { bridge } from './bridge-state.svelte.js';
	import { hostedVmRunning } from './bridge-status.js';
	import { booksBridgeHosted, hosted, loadHostedPeers } from './hosted-status.svelte.js';

	/** @type {{ accounts: string[], sections: string[] }} */
	let kept = $state({ accounts: [], sections: [] });
	let busy = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);

	let mail = $state({ host: '', port: '993', user: '', password: '', accountingAddress: '' });
	let kraken = $state({ key: '', secret: '' });
	let paperless = $state({ baseUrl: '', token: '' });
	let alchemy = $state({ key: '' });
	let llm = $state({ key: '', model: '', itemHash: '', measurement: '' });
	let llmReady = $derived(
		Boolean(llm.key.trim() && llm.model.trim()) &&
			/^[0-9a-f]{64}$/.test(llm.itemHash.trim()) &&
			/^[0-9a-f]{32,}$/i.test(llm.measurement.trim())
	);

	/** What is kept, to show: non-secret values, and of a secret only that it is there. */
	/** @type {import('./hosted-settings.js').KeptEntry[]} */
	let view = $state([]);
	/** The integrations' names; brands are not translated. @type {Record<string, string>} */
	const NAME = {
		kraken: 'Kraken',
		paperless: 'Paperless-ngx',
		enablebanking: 'Enable Banking',
		alchemy: 'Alchemy',
		coingecko: 'CoinGecko',
		bitcoin: 'Bitcoin (zpub)'
	};
	/** @param {string} id */
	const nameOf = (id) => NAME[id] ?? t(`integrationen.hostedSettings.${id}`);

	async function refresh() {
		[kept, view] = await Promise.all([
			hostedSettingsNames().catch(() => ({ accounts: [], sections: [] })),
			hostedSettingsView().catch(() => [])
		]);
	}
	$effect(() => {
		if (app.sync.online) refresh();
	});
	$effect(() => {
		void app.sync.online;
		loadHostedPeers().catch(() => {});
	});
	// Once a hosted bridge is the books' bridge, `settings.export` would ask the VM, not this computer.
	let asksTheVm = $derived(Boolean(booksBridgeHosted()));
	// What is kept reaches a VM only at its start: a running one has to be stopped and started.
	let vmRuns = $derived(hostedVmRunning(hosted) || asksTheVm);

	/** @param {string} what @param {() => Promise<unknown>} f */
	async function run(what, f) {
		busy = what;
		error = null;
		done = null;
		try {
			await f();
			done = what;
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}

	const takeOver = () => run('takeOver', () => takeOverBridgeSettings());
	const forget = () => {
		if (confirm(t('integrationen.hostedSettings.forgetConfirm')))
			run('forget', () => forgetHostedSettings());
	};

	/** @param {SubmitEvent} event */
	function saveMail(event) {
		event.preventDefault();
		run('mail', async () => {
			await keepHostedSettings({
				config: {
					mail: {
						host: mail.host.trim(),
						port: Number(mail.port) || 993,
						tls: 'implicit',
						user: mail.user.trim(),
						...(mail.accountingAddress.trim()
							? { accountingAddress: mail.accountingAddress.trim() }
							: {})
					}
				},
				secrets: { imap: mail.password }
			});
			mail.password = '';
		});
	}
	/** @param {SubmitEvent} event */
	function saveKraken(event) {
		event.preventDefault();
		run('kraken', async () => {
			await keepHostedSettings({
				config: { kraken: { configured: true } },
				secrets: {
					kraken: JSON.stringify({ key: kraken.key.trim(), secret: kraken.secret.trim() })
				}
			});
			kraken = { key: '', secret: '' };
		});
	}
	/** @param {SubmitEvent} event */
	function savePaperless(event) {
		event.preventDefault();
		run('paperless', async () => {
			await keepHostedSettings({
				config: { paperless: { configured: true, baseUrl: paperless.baseUrl.trim() } },
				secrets: { paperless: paperless.token.trim() }
			});
			paperless.token = '';
		});
	}
	/** @param {SubmitEvent} event */
	function saveAlchemy(event) {
		event.preventDefault();
		run('alchemy', async () => {
			await keepHostedSettings({ secrets: { alchemy: alchemy.key.trim() } });
			alchemy.key = '';
		});
	}

	/** @param {SubmitEvent} event */
	function saveLlm(event) {
		event.preventDefault();
		run('llm', async () => {
			const model = llm.model.trim();
			await keepHostedSettings({
				// Only LibertAI's enclave, pinned (#754): the VM checks it before every request.
				config: {
					llm: {
						baseUrl: 'https://api.libertai.io/v1',
						model,
						retryModel: model,
						redactTerms: [],
						redaction: 'off',
						configured: true,
						tee: {
							provider: 'libertai',
							itemHash: llm.itemHash.trim(),
							measurement: llm.measurement.trim(),
							sourceCommit: null,
							pinnedAt: new Date().toISOString()
						}
					}
				},
				secrets: { llm: llm.key.trim() }
			});
			llm = { key: '', model: '', itemHash: '', measurement: '' };
		});
	}

	const input = 'mt-1 min-h-11 w-full rounded-md border px-2 text-sm';
	const save =
		'min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<section
	id="hosted-settings"
	class="mt-4 scroll-mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	data-testid="hosted-settings"
>
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.hostedSettings.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.hostedSettings.intro')}</p>

	{#if !app.sync.online}
		<p class="mt-3 text-sm text-text">{t('messages.bridge.needsSync')}</p>
	{:else}
		<p class="mt-3 text-sm text-text" data-testid="hosted-settings-kept">
			{#if kept.accounts.length || kept.sections.length}
				{t('integrationen.hostedSettings.kept', {
					names: [...new Set([...kept.sections, ...kept.accounts])].join(', ')
				})}
			{:else}
				{t('integrationen.hostedSettings.none')}
			{/if}
		</p>

		{#if view.length}
			<!-- Everything that is not secret, read-only; of a secret only that it is kept. -->
			<p class="mt-3 text-xs text-faint">{t('integrationen.hostedSettings.viewHint')}</p>
			<ul class="mt-1 divide-y divide-border text-sm" data-testid="hosted-settings-view">
				{#each view as entry (entry.id)}
					<li class="py-2" data-testid="hosted-settings-view-{entry.id}">
						<span class="font-medium text-heading">{nameOf(entry.id)}</span>
						<dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5">
							{#each entry.fields as field (field.key)}
								<dt class="text-faint">{t(`integrationen.hostedSettings.field.${field.key}`)}</dt>
								<dd class="font-mono text-xs break-all text-heading">{field.value}</dd>
							{/each}
							<dt class="text-faint">{t('integrationen.hostedSettings.secretPart')}</dt>
							<dd
								class={entry.secret ? 'text-success' : 'text-danger'}
								data-testid="hosted-settings-view-secret"
								data-kept={entry.secret ? 'true' : 'false'}
							>
								{t(
									entry.secret
										? 'integrationen.hostedSettings.secretKept'
										: 'integrationen.hostedSettings.secretMissing'
								)}
							</dd>
						</dl>
					</li>
				{/each}
			</ul>
		{/if}

		{#if !app.member}
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					class={save}
					disabled={Boolean(busy) || !bridge.peerId || asksTheVm}
					aria-describedby="hosted-settings-take-over-hint"
					onclick={takeOver}
					data-testid="hosted-settings-take-over"
					>{t('integrationen.hostedSettings.takeOver')}</button
				>
				{#if kept.accounts.length || kept.sections.length}
					<button
						type="button"
						class="min-h-11 rounded-md border border-border px-4 text-sm disabled:opacity-50"
						disabled={Boolean(busy)}
						onclick={forget}>{t('integrationen.hostedSettings.forget')}</button
					>
				{/if}
			</div>
			<p
				id="hosted-settings-take-over-hint"
				class="mt-1 text-xs {asksTheVm ? 'text-text' : 'text-faint'}"
				data-testid="hosted-settings-take-over-hint"
				data-hosted={asksTheVm ? 'true' : 'false'}
			>
				{t(
					asksTheVm
						? 'integrationen.hostedSettings.takeOverHosted'
						: 'integrationen.hostedSettings.takeOverHint'
				)}
			</p>

			<details class="mt-4">
				<summary class="cursor-pointer text-sm font-medium"
					>{t('integrationen.hostedSettings.mail')}</summary
				>
				<form class="mt-2 grid gap-2 sm:grid-cols-2" onsubmit={saveMail}>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.mailHost')}</span>
						<input
							class={input}
							bind:value={mail.host}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.mailPort')}</span>
						<input class={input} bind:value={mail.port} inputmode="numeric" /></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.mailUser')}</span>
						<input
							class={input}
							bind:value={mail.user}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.password')}</span>
						<input
							class={input}
							type="password"
							bind:value={mail.password}
							autocomplete="new-password"
						/></label
					>
					<label class="text-sm sm:col-span-2"
						><span class="text-faint">{t('integrationen.hostedSettings.mailAccounting')}</span>
						<input class={input} bind:value={mail.accountingAddress} autocomplete="off" /></label
					>
					<button
						type="submit"
						class={save}
						disabled={Boolean(busy) || !mail.host.trim() || !mail.user.trim() || !mail.password}
						>{t('integrationen.hostedSettings.keep')}</button
					>
				</form>
			</details>

			<details class="mt-2">
				<summary class="cursor-pointer text-sm font-medium"
					>{t('integrationen.hostedSettings.llm')}</summary
				>
				<p class="mt-2 text-xs text-faint">{t('integrationen.hostedSettings.llmHint')}</p>
				<form class="mt-2 grid gap-2 sm:grid-cols-2" onsubmit={saveLlm}>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.apiKey')}</span>
						<input class={input} type="password" bind:value={llm.key} autocomplete="off" /></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.llmModel')}</span>
						<input
							class={input}
							bind:value={llm.model}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.llmItemHash')}</span>
						<input
							class={input}
							bind:value={llm.itemHash}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.llmMeasurement')}</span>
						<input
							class={input}
							bind:value={llm.measurement}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<button type="submit" class={save} disabled={Boolean(busy) || !llmReady}
						>{t('integrationen.hostedSettings.keep')}</button
					>
				</form>
			</details>

			<details class="mt-2">
				<summary class="cursor-pointer text-sm font-medium">Kraken</summary>
				<form class="mt-2 grid gap-2 sm:grid-cols-2" onsubmit={saveKraken}>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.apiKey')}</span>
						<input
							class={input}
							type="password"
							bind:value={kraken.key}
							autocomplete="off"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.apiSecret')}</span>
						<input
							class={input}
							type="password"
							bind:value={kraken.secret}
							autocomplete="off"
						/></label
					>
					<button
						type="submit"
						class={save}
						disabled={Boolean(busy) || !kraken.key.trim() || !kraken.secret.trim()}
						>{t('integrationen.hostedSettings.keep')}</button
					>
				</form>
			</details>

			<details class="mt-2">
				<summary class="cursor-pointer text-sm font-medium">Paperless-ngx</summary>
				<form class="mt-2 grid gap-2 sm:grid-cols-2" onsubmit={savePaperless}>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.paperlessUrl')}</span>
						<input
							class={input}
							bind:value={paperless.baseUrl}
							autocomplete="off"
							spellcheck="false"
						/></label
					>
					<label class="text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.apiToken')}</span>
						<input
							class={input}
							type="password"
							bind:value={paperless.token}
							autocomplete="off"
						/></label
					>
					<button
						type="submit"
						class={save}
						disabled={Boolean(busy) ||
							!/^https:\/\//.test(paperless.baseUrl.trim()) ||
							!paperless.token.trim()}>{t('integrationen.hostedSettings.keep')}</button
					>
				</form>
			</details>

			<details class="mt-2">
				<summary class="cursor-pointer text-sm font-medium">Alchemy</summary>
				<form class="mt-2 flex flex-wrap items-end gap-2" onsubmit={saveAlchemy}>
					<label class="min-w-0 flex-1 text-sm"
						><span class="text-faint">{t('integrationen.hostedSettings.apiKey')}</span>
						<input
							class={input}
							type="password"
							bind:value={alchemy.key}
							autocomplete="off"
						/></label
					>
					<button type="submit" class={save} disabled={Boolean(busy) || !alchemy.key.trim()}
						>{t('integrationen.hostedSettings.keep')}</button
					>
				</form>
			</details>
			<p class="mt-2 text-xs text-faint">{t('integrationen.hostedSettings.othersHint')}</p>
		{/if}
	{/if}
	{#if done && !busy}
		<p class="mt-2 text-sm text-success" data-testid="hosted-settings-done">
			{t(
				vmRuns ? 'integrationen.hostedSettings.savedRunning' : 'integrationen.hostedSettings.saved'
			)}
		</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="hosted-settings-error">{error}</p>
	{/if}
</section>

<script>
	// "QR-Code scannen" (#123): the camera and the browser's own BarcodeDetector
	// (Chrome on Android and on the Mac), no library and no request: the image
	// never leaves this device. Where the browser has no detector, the button
	// is not shown and the id is typed or pasted instead.
	import { onDestroy, tick } from 'svelte';
	import { t } from '$lib/i18n/index.js';

	/** @type {{ onscan: (text: string) => void, class?: string }} */
	let { onscan, class: buttonClass = '' } = $props();

	const scanSupported = () =>
		typeof (/** @type {any} */ (globalThis).BarcodeDetector) === 'function' &&
		typeof navigator !== 'undefined' &&
		typeof navigator.mediaDevices?.getUserMedia === 'function';

	let scanning = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {HTMLVideoElement | undefined} */
	let video = $state();
	/** @type {MediaStream | null} */
	let stream = null;
	/** @type {ReturnType<typeof setInterval> | undefined} */
	let timer;

	function stop() {
		clearInterval(timer);
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
		scanning = false;
	}

	async function start() {
		error = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			scanning = true;
			await tick();
			if (!video) throw new Error('no video element');
			video.srcObject = stream;
			await video.play();
			const detector = new /** @type {any} */ (globalThis).BarcodeDetector({
				formats: ['qr_code']
			});
			timer = setInterval(async () => {
				if (!video || video.readyState < 2) return;
				try {
					const [found] = await detector.detect(video);
					if (found?.rawValue) {
						stop();
						onscan(String(found.rawValue));
					}
				} catch {
					// A frame it could not read: the next one.
				}
			}, 250);
		} catch (e) {
			stop();
			error = t('devices.scanFailed', { reason: e instanceof Error ? e.name || e.message : '?' });
		}
	}

	onDestroy(stop);
</script>

{#if scanSupported()}
	{#if scanning}
		<div class="mt-2" data-testid="devices-scan-view">
			<video
				bind:this={video}
				class="w-64 max-w-full rounded-md border border-border"
				playsinline
				muted
			></video>
			<p class="mt-1 text-xs text-faint">{t('devices.scanHint')}</p>
			<button
				type="button"
				class="mt-1 {buttonClass}"
				onclick={stop}
				data-testid="devices-scan-stop">{t('devices.scanStop')}</button
			>
		</div>
	{:else}
		<button type="button" class={buttonClass} onclick={start} data-testid="devices-scan"
			>{t('devices.scan')}</button
		>
	{/if}
	{#if error}
		<p class="mt-1 text-sm text-danger" role="alert">{error}</p>
	{/if}
{/if}

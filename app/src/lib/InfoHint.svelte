<script module>
	let hintIds = 0;
</script>

<script>
	// A small ⓘ that opens a layer on hover, keyboard focus or a tap. A tap pins
	// it until a second tap, a click outside or Escape. Escape closes only the
	// layer, before a panel around it (a payment's detail) sees the key.
	//
	// `interactive`: the layer holds a button or link (a download, say). Then
	// it is a disclosure (aria-controls, aria-expanded) rather than a tooltip,
	// because a tooltip must not hold anything to press.

	/**
	 * @type {{
	 *   label: string,
	 *   testid?: string,
	 *   idPrefix?: string,
	 *   interactive?: boolean,
	 *   width?: string,
	 *   mode?: string,
	 *   onopen?: () => void,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let {
		label,
		testid = 'info',
		idPrefix = 'info',
		interactive = false,
		width = 'w-64',
		mode = '',
		onopen,
		children
	} = $props();

	const id = `${idPrefix}-${++hintIds}`;
	let open = $state(false);
	/** Opened by a tap or click: stays until closed, not only while hovered. */
	let pinned = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	function show() {
		open = true;
		onopen?.();
	}
	function hide() {
		if (!pinned) open = false;
	}
	function close() {
		open = false;
		pinned = false;
	}

	/** @param {MouseEvent} e */
	function outside(e) {
		if (open && root && !e.composedPath().includes(root)) close();
	}
	/** @param {KeyboardEvent} e */
	function escape(e) {
		if (!open || e.key !== 'Escape') return;
		e.stopPropagation();
		close();
	}
	/** @param {FocusEvent} e  Focus moving into the layer keeps it open. */
	function blur(e) {
		if (root && e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
		hide();
	}
</script>

<svelte:window onclick={outside} onkeydowncapture={escape} />

<span
	class="relative inline-flex align-middle"
	bind:this={root}
	onmouseenter={show}
	onmouseleave={hide}
	role="presentation"
>
	<button
		type="button"
		class="inline-flex h-5 w-5 items-center justify-center rounded-full text-faint outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
		aria-label={label}
		aria-describedby={interactive ? undefined : id}
		aria-controls={interactive ? id : undefined}
		aria-expanded={open}
		data-testid={testid}
		onfocus={show}
		onblur={blur}
		onclick={(e) => {
			e.stopPropagation();
			if (pinned) close();
			else {
				pinned = true;
				show();
			}
		}}
	>
		<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3" />
			<path d="M8 7v4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			<circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
		</svg>
	</button>
	<span
		{id}
		role={interactive ? 'group' : 'tooltip'}
		aria-label={interactive ? label : undefined}
		hidden={!open}
		class="absolute top-full left-0 z-40 mt-1 {width} max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-2.5 text-left text-xs font-normal whitespace-normal text-text shadow-lg"
		data-testid="{testid}-tip"
		data-mode={mode}
		onfocusout={blur}
	>
		{@render children()}
	</span>
</span>

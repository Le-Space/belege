<script>
	/**
	 * The product mark of Le Space Belege: "Der erste Knoten" with the local node
	 * drawn as a till receipt (torn edge, two printed lines cut out).
	 * Generated in Le-Space/landing by docs/le-space-brand/build/build_brand.py
	 * (le-space-belege-mark-*.svg); copy the path from there, do not redraw it.
	 * Theme-aware through the --coral / --cyan CSS variables.
	 */
	let { size = 52, label = 'Le Space Belege' } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 96 96"
	xmlns="http://www.w3.org/2000/svg"
	role="img"
	aria-label={label}
	class="shrink-0"
>
	<line
		x1="42.7"
		y1="49.96"
		x2="58.56"
		y2="34.94"
		stroke="var(--cyan)"
		stroke-width="4"
		stroke-linecap="round"
	/>
	<line
		x1="47.43"
		y1="63.58"
		x2="62.8"
		y2="64.98"
		stroke="var(--cyan)"
		stroke-width="4"
		stroke-linecap="round"
		stroke-dasharray="0.1 8"
	/>
	<line
		x1="69.85"
		y1="38.36"
		x2="72.41"
		y2="55.37"
		stroke="var(--cyan)"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-dasharray="0.1 6"
		opacity="0.65"
	/>
	<path
		d="M21 47 H39 Q41 47 41 49 V74 L38.25 77 L35.5 74 L32.75 77 L30 74 L27.25 77 L24.5 74 L21.75 77 L19 74 V49 Q19 47 21 47 Z M23.5 53 H36.5 V56.4 H23.5 Z M23.5 60 H32 V63.4 H23.5 Z"
		fill-rule="evenodd"
		fill="var(--coral)"
	/>
	<circle cx="68" cy="26" r="8" fill="none" stroke="var(--cyan)" stroke-width="5" />
	<circle cx="74" cy="66" r="6.5" fill="none" stroke="var(--cyan)" stroke-width="4.5" />
	<circle cx="17" cy="21" r="2.6" fill="var(--cyan)" opacity="0.55" />
</svg>

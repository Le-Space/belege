<!--
	A QR code, drawn as markup: one path of the code's dark modules. No
	`{@html}` – the app has none (AGENTS.md, "Web app"; no-raw-html.spec.js) –
	so whatever the text is, a link, a peer id or a signed code, it only ever
	decides which squares are dark.
-->
<script>
	import { encode } from 'uqr';

	/** @type {{ text: string, border?: number }} */
	let { text, border = 2 } = $props();

	const code = $derived(encode(text, { border }));
	const path = $derived.by(() => {
		let d = '';
		for (let row = 0; row < code.size; row++) {
			for (let col = 0; col < code.size; col++) {
				if (code.data[row][col]) d += `M${col},${row}h1v1h-1z`;
			}
		}
		return d;
	});
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 {code.size} {code.size}"
	shape-rendering="crispEdges"
>
	<rect fill="white" width={code.size} height={code.size} />
	<path fill="black" d={path} />
</svg>

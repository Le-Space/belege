// SPDX-License-Identifier: AGPL-3.0-or-later
// A made-up brand for the tests: a square that draws itself, two languages.
export const BRAND = {
	name: 'Wolkenfabrik Demo',
	mark: () =>
		'<svg class="mark" viewBox="0 0 10 10" aria-hidden="true"><rect class="box" width="10" height="10"/></svg>',
	words:
		'<span class="words" aria-hidden="true"><span class="prefix">WOLKEN</span><span class="name">fabrik</span></span>',
	css: '.box { fill: var(--accent); opacity: 0; } .go .box { animation: fade 400ms ease-out forwards; }\n',
	stillCss: '.scene .box{opacity:1;animation:none}',
	palette: {
		night: '#101010',
		panel: '#202020',
		snow: '#fafafa',
		muted: '#999999',
		accent: '#ff8800',
		accent2: '#8888ff',
		ink: '#111111',
		line: '#333333'
	},
	font: null,
	site: 'demo.example.com',
	qr: '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
	texts: {
		en: {
			tagline: 'Clouds, made to order.',
			introSay: 'Wolkenfabrik. Clouds, made to order.',
			scene: 'Chapter',
			facts: ['made up', 'for tests'],
			outroSay: 'Wolkenfabrik, at demo dot example dot com.',
			scan: 'Scan to open'
		},
		de: {
			tagline: 'Wolken nach Maß.',
			introSay: 'Wolkenfabrik. Wolken nach Maß.',
			scene: 'Kapitel',
			facts: ['ausgedacht', 'für Tests'],
			outroSay: 'Wolkenfabrik, unter demo Punkt example Punkt com.',
			scan: 'Scannen und öffnen'
		}
	}
};

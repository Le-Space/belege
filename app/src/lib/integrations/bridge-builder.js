// The builder Belege trusts to seal the bridge's own image (#777): its own
// module, so a view that shows the pins (the build journey's evidence) does
// not load the build's code with them. hosted-image.js uses and re-exports it.

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-21 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 *
 * The plain image is the bridge at the tag v0.50.0 (commit below): with the
 * NEAR swap reader and the bookings it replaced (#898, #923). The publication
 * before (2026-11-19, V-PROGRAM c622b325…, plain image c594b999… of commit
 * d0a1e73) sealed a bridge without them; an image built with that one has to
 * be built again to have them.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: '8a56e0858f2150a0a1f751597a3d5331893014df7187f32fbb77c2ad6767cece',
	program: {
		allow_amend: false,
		environment: { internet: true },
		metadata: { name: 'sealed-image-builder-belege-bridge' },
		payment: { type: 'credit' },
		requirements: {
			node: { node_hash: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa' }
		},
		resources: { memory: 6144, seconds: 30, vcpus: 2 },
		runtime: {
			comment: '',
			ref: 'b8e43148123e34f5f02ffd65bab62b716b74706ba77cf10cbe329af32f01f10a'
		},
		verification: {
			backend: 'sev_snp',
			measurements: [
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'bc34a86cfa9c680835158ef4f25f64b22223b9e2b5b01993b4a99cbd0ded43aaea77b23cfa3f51adb8b4a87a9b7d5eb6'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'11a1c15239f9ab9e82991e09c1b6997b8bdd90539e9c367aca698387621116a36b628b905cfb6a18ecfe38fe8af5f7f8'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '40d0616c06e18f27b7c1827a37a53802ebae76ae6f0da86444329ab69d9ca435',
				ref: 'b4bdbba564d6a0e8ca252161ca358be9c4b7fe91c3198d62fe3b1bafa7493c32',
				roothash: 'ab5020cad218febe53b5bc5720dd2b28d5a29ac64450da04c9b859fece32640c'
			}
		],
		workload: {
			hash_tree: 'a90bbcea7155d5b1ba69d096af6d1fd89feb5a7fcbf51f88dce1febba45b0fd1',
			ref: 'd3764c0e00d153c5903f63ddbcd14da13436b69c3856a063448129a6c0213435',
			roothash: 'a7b351655e01660d401a9de1eab84098c0d4d66c9a1de9ba1abb7c52bee11887'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'bc34a86cfa9c680835158ef4f25f64b22223b9e2b5b01993b4a99cbd0ded43aaea77b23cfa3f51adb8b4a87a9b7d5eb6',
		'11a1c15239f9ab9e82991e09c1b6997b8bdd90539e9c367aca698387621116a36b628b905cfb6a18ecfe38fe8af5f7f8'
	],
	policy: 196608,
	plain: {
		sha256: '444782e9b2dcd85853dfc4e38ea99b69129679608a50018eb421532737ee82ae',
		store: '4c9bceb86b2620c5866698eed2ad64f637ca493f94b8989081459d11a8ef63c8',
		commit: '508293ca3ad43c57ca9aa63c7207f4ca8a4bb80f'
	}
});

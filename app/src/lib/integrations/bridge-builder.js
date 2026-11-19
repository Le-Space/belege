// The builder Belege trusts to seal the bridge's own image (#777): its own
// module, so a view that shows the pins (the build journey's evidence) does
// not load the build's code with them. hosted-image.js uses and re-exports it.

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-19 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 *
 * The plain image is the bridge at the commit below: the first with the fix
 * for a node that waits forever at its start when it listens at two relays
 * (#828). The publication before (2026-11-16, V-PROGRAM 546e759c…, plain
 * image 25f03bb5… of commit 53a65aa) sealed a bridge without it; an image
 * built with that one has to be built again.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: 'c622b32589390ac66f938a1ba402662a0cd43e4ba97cd12d84c97a0c64f19091',
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
							'f54e86dd271180430d7d594fe9f07c5e2ede0b171bfea1e22139676e2ee55666ad9623ded2e29d3a7b4d7a4537d2ca0f'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'335c224a3cc0e8680b0c4500b141304dedb909b85a4b94fdabaf92f0654e42ce0906ec641fdd9aac41eaa0c41d36377f'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '4a2de0c324ea476b6f8d82feb9d2977bea14f8164898f6e0659c537722a06500',
				ref: '1ce3b735854888af9b5cf42a9cdbc022b43020802515926cc648794c90787899',
				roothash: '94fa70c29b1753404732e37b35c20c7949651111b468dc56e66cfa53119e43b6'
			}
		],
		workload: {
			hash_tree: '5ea3043e9c264c6bfcaa9c668d55d8d27dd47e7dbeee93d42055c64231569fd2',
			ref: 'ca8b89f3a0bccb3baa5c6c6854b7ad8e7f2026d1ff30d97285a2387f53d474a9',
			roothash: '2eb99c3400f838e8d00795f801081418ced7e37be3e7998e81bcca2815da620d'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'f54e86dd271180430d7d594fe9f07c5e2ede0b171bfea1e22139676e2ee55666ad9623ded2e29d3a7b4d7a4537d2ca0f',
		'335c224a3cc0e8680b0c4500b141304dedb909b85a4b94fdabaf92f0654e42ce0906ec641fdd9aac41eaa0c41d36377f'
	],
	policy: 196608,
	plain: {
		sha256: 'c594b999d344dfb73d227626d2dad270ace74e52a3de8c7e3cfbeadafc259ab7',
		store: 'a20838098975fde24d869a2a083dea3e69bd002aa370fe2ffc6836e3825ba527',
		commit: 'd0a1e73a5587e89c91aac073be3790966a5e1556'
	}
});

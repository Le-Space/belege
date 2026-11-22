// The builder Belege trusts to seal the bridge's own image (#777): its own
// module, so a view that shows the pins (the build journey's evidence) does
// not load the build's code with them. hosted-image.js uses and re-exports it.

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-22 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 *
 * The plain image is the bridge at the tag v0.52.0 (commit below): with the
 * NEAR storage deposits tied to their swap (#968) and the Bitcoin reading by
 * extended key (#966). The publication before (2026-11-21, V-PROGRAM
 * 8a56e085…, plain image 444782e9… of commit 508293c, the tag v0.50.0)
 * sealed a bridge without them; an image built with that one has to be built
 * again to have them.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: '8c3d652fad0654c1f6e8d7a423ea726abab8de69ee9b7adf32900ed8ad762167',
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
							'1393421dbe12c3ed0ffbbd457724714555ba2c24396baf2710601f639bf11c844b368169bc32bcef327725699d96d4d1'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'f81502bfdf09b9762f805a21d3a3c75d05e3a197e384484d43d9aa638e8f6c991d072da272cfb7d41d3af66c4b618185'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '41e761e95d5d9cb563e2b9edafaeaba479fbf34c4fbac722824972fc2c0d1b6b',
				ref: 'f7bb9f7b747ff544c2b70be4b2c050c5b59f45cfea19d38d55445201f55bebe3',
				roothash: '504fd3cb5515e0db8e474f52191f571b1d5dcb9f04fa454e508120128dfe2692'
			}
		],
		workload: {
			hash_tree: '6b51719cdfe8e7a4b4afa3c71d7fd773c7ce5167cb2aaabf8d6c4fbc721e7e3a',
			ref: '8f5e722b6ac734b1c0fd287217339a14247be2952aa0960f03256a2a285ae68b',
			roothash: 'ff955d0f8ed3a3890d02a85fdbb2e29a7ac191e06cb267f14c077d98ae122df8'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'1393421dbe12c3ed0ffbbd457724714555ba2c24396baf2710601f639bf11c844b368169bc32bcef327725699d96d4d1',
		'f81502bfdf09b9762f805a21d3a3c75d05e3a197e384484d43d9aa638e8f6c991d072da272cfb7d41d3af66c4b618185'
	],
	policy: 196608,
	plain: {
		sha256: 'e3e2cd565300f9a1e55651c8f3b80a6084a935e07fec05204b99052be84f82fb',
		store: '6f9e0fbe06367698e5f72de8dfc1efbab558ea2361d7a94942b1fed19740c4be',
		commit: '3935d93f453a7c0ecd03b79ebda53b2fc58661f7'
	}
});

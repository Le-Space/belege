// The builder Belege trusts to seal the bridge's own image (#777): its own
// module, so a view that shows the pins (the build journey's evidence) does
// not load the build's code with them. hosted-image.js uses and re-exports it.

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-16 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: '546e759c3721ccee9678105f65e9c6461b0d99ab9d83a9c8cbd0d28cf6eae52f',
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
							'5da11fd2d742e92569953329775e3f66414bb03825731ffa5fd889cb1baefbc62228aea5ddf4437c7771c918c299d88b'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'cb5213bce94283fbfda642c716625b9034e007371159f9431043d5ccb379c7b6f42f35cca2511ee92595b2445436f705'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '6d5f85f0bcb9061394d82998a40f8942661bddc08a4bcb9acf9c942e2ddbedbd',
				ref: 'f785d2ff21744b9e9742cee1283a38ef5cb0cf647dd9e2a68bc838f61bd988a2',
				roothash: '54bed2eebb1955b54b9a3dd1b6509cdbf13e57c849f8f950e10f043e626b0e8a'
			}
		],
		workload: {
			hash_tree: '67d6294648f96d0f5c007fee3f974431518309a128cd24d1a11c81c982d4dbf8',
			ref: '39775ea9e83e3e1a3d6263692d514dd296fce0111d4262c46f12c97f6b038d95',
			roothash: 'a1fe0c39f960e5470db1a7114909400b9b8a5a9a3c97f37c9ec70211eefc52b3'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'5da11fd2d742e92569953329775e3f66414bb03825731ffa5fd889cb1baefbc62228aea5ddf4437c7771c918c299d88b',
		'cb5213bce94283fbfda642c716625b9034e007371159f9431043d5ccb379c7b6f42f35cca2511ee92595b2445436f705'
	],
	policy: 196608,
	plain: {
		sha256: '25f03bb56bc7d305790ae90d878a1d8b9cf71871b5899dc179deeac9ede8efa5',
		store: '955d9a89252044708d301b2901af8c00d00715c3d25539ba1773fe4e6630f31e',
		commit: '53a65aa9c388dcbabc9a91eee376968831e31e1a'
	}
});

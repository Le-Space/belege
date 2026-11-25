// The builder Belege trusts to seal the bridge's own image (#777): its own
// module, so a view that shows the pins (the build journey's evidence) does
// not load the build's code with them. hosted-image.js uses and re-exports it.

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-24 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 *
 * The plain image is the bridge at the tag v0.56.0 (commit below): with the
 * NEAR storage deposits that say what they were for (#1015), unpairing that
 * forgets the last pairing (#1014), unlisted EVM tokens counted only when the
 * wallet moved them (#999) and Eigenbelege in English. The publication before
 * (2026-11-22, V-PROGRAM 8c3d652f…, plain image e3e2cd56… of commit 3935d93,
 * the tag v0.52.0) sealed a bridge without them; an image built with that one
 * has to be built again to have them.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: '0d0e324e5c87c44343da3921cee8cbd735c7434da7012257817824f11cdcf340',
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
							'68927416f912304d04d3dd8162da907e813cd9cab31904fc27fa7e5d64b70cc716069fa0f195e9bccf4596f5dcb5a629'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'aaafc38fa81abd6178ab01b14d9614d606e6e9a81b3608b2b5cee835ed83a557ad7da94faca4264135f38b8269ef6668'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '028e87cbf8d6677225f880f132b91dd255e286ec878979eeb51c579002c56711',
				ref: '82ab193251041cd1eec90afd945f2cb83ea7306c0f77bae3c19e7eb0f0c44028',
				roothash: '1a7bf17e1784d97d55194784f683ea65a3ad19bdaf76a0a2303138f58845da89'
			}
		],
		workload: {
			hash_tree: '1f75ac7a3501c0e9acbc6e78c41d2f8a150581d2d01ab14966ae59a509e4ba23',
			ref: 'fa7828ed8788b8fcbed293321c8f7c0e1c72faefb68fb4c8c6a3332139ac2816',
			roothash: '1b546dc42327c2d2d9f12043d2385f5de849c274d83e7a8cea8be7a5a658f529'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'68927416f912304d04d3dd8162da907e813cd9cab31904fc27fa7e5d64b70cc716069fa0f195e9bccf4596f5dcb5a629',
		'aaafc38fa81abd6178ab01b14d9614d606e6e9a81b3608b2b5cee835ed83a557ad7da94faca4264135f38b8269ef6668'
	],
	policy: 196608,
	plain: {
		sha256: 'b9a80deac244d6683d2353716584a1ca477ae41ec88bedb0b28447c97a5a5484',
		store: '7eb4ae876bed33443ad7f9fc80eafc76733018c336e5eb94f86b0e7e99c2276c',
		commit: 'af75b48eb13d31fb1339dc9205c618308540100b'
	}
});

// Before the VM is deployed: does the wallet hold enough Aleph credits?
//
// Aleph accepts a pay-as-you-go INSTANCE only while the paying wallet holds
// credits for a day of it, however short the run. Without them every CRN
// rejects the INSTANCE with a bare "error 6"; this says what is missing.
//
// The estimate counts the compute units only (Aleph's pricing aggregate); the
// RootFS adds a little storage on top, so the check is the floor, not exact.
//
//   ALEPH_PRIVATE_KEY   the paying wallet (only its address is used)
//   ALEPH_VM_VCPUS      default 2
//   ALEPH_VM_MEMORY_MIB default 4096
//   ALEPH_API_HOST      default https://api2.aleph.im
import { Wallet } from 'ethers';

const api = process.env.ALEPH_API_HOST || 'https://api2.aleph.im';
const vcpus = Number(process.env.ALEPH_VM_VCPUS || 2);
const memoryMiB = Number(process.env.ALEPH_VM_MEMORY_MIB || 4096);
// The pricing aggregate is published by Aleph's settings account.
const PRICING = '0xFba561a84A537fCaa567bb7A2257e7142701ae2A';
const MIN_RUNTIME_HOURS = 24;

const key = (process.env.ALEPH_PRIVATE_KEY || '').trim();
if (!key) throw new Error('ALEPH_PRIVATE_KEY is not set');
const address = new Wallet(key.startsWith('0x') ? key : `0x${key}`).address;

/** @param {string} path */
async function get(path) {
	const response = await fetch(new URL(path, api), { signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`${new URL(path, api).host} answered ${response.status}`);
	return response.json();
}

const pricing = (await get(`/api/v0/aggregates/${PRICING}.json?keys=pricing`))?.data?.pricing
	?.instance;
const unit = pricing?.compute_unit;
const unitCredits = Number(pricing?.price?.compute_unit?.credit);
if (!unit || !Number.isFinite(unitCredits))
	throw new Error('Aleph pricing aggregate has no credit price for an instance compute unit');
const computeUnits = Math.max(
	Math.ceil(vcpus / unit.vcpus),
	Math.ceil(memoryMiB / unit.memory_mib)
);
const required = Math.ceil(computeUnits * unitCredits * MIN_RUNTIME_HOURS);

const balance = await get(`/api/v0/addresses/${address}/balance`);
const available = Number(balance?.credit_balance ?? 0);

console.log(
	`[credit-check] ${address}: ${available} credits; a ${vcpus} vCPU / ${memoryMiB} MiB VM ` +
		`(${computeUnits} compute units × ${unitCredits} credits/h × ${MIN_RUNTIME_HOURS} h) needs at least ${required}`
);
if (available < required) {
	const message =
		`Not enough Aleph credits to deploy the VM: wallet ${address} holds ${available}, ` +
		`Aleph wants at least ${required} (a day of the VM) before it accepts it. ` +
		`Top up the wallet of ALEPH_PLAYWRIGHT_PRIVATE_KEY by at least ${required - available} credits.`;
	console.log(`::error title=Aleph credits::${message}`);
	process.exit(1);
}

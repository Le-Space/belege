// Which receipts are our own invoices (issue #354): their VAT is output VAT,
// never input VAT. Pure.
//
// Ours, in this order:
//   - the person said so, either way (`ownInvoice: true` / `false` on the
//     receipt, "Eigene Rechnung" / "Doch kein eigener Beleg"); an invoice the
//     invoicing app sent is `true` by where it came from (ucep/issued.js)
//   - its vendor is one of the company names (Einstellungen). The model sees
//     those names redacted as `[FIRMA]` and names that mark as the vendor of
//     an own invoice; the app puts the first name back (bridge/client.js), so
//     the name is what stands here – the bare mark counts too
//   - its vendor VAT ID is our own (Buchhaltung)

import { isOwnName } from '../matching/classify.js';

const COMPANY_MARK = '[FIRMA]';

/** `de 123 456 789` → `DE123456789`. @param {unknown} id */
export const normalizeVatId = (id) =>
	String(id ?? '')
		.replace(/[\s.-]+/g, '')
		.toUpperCase();

/**
 * @param {{ companyNames?: string[], ownVatId?: string }} [own]
 * @returns {(r: Record<string, any>) => boolean}
 */
export function ownInvoiceTest({ companyNames = [], ownVatId = '' } = {}) {
	const vatId = normalizeVatId(ownVatId);
	return (r) => {
		if (r.ownInvoice === true) return true;
		if (r.ownInvoice === false) return false;
		const e = r.extraction ?? {};
		const vendor = String(r.vendor ?? e.vendor ?? '').trim();
		if (vendor === COMPANY_MARK) return true;
		if (vendor && companyNames.some((name) => isOwnName(vendor, name))) return true;
		return Boolean(vatId) && normalizeVatId(e.vendor_vat_id) === vatId;
	};
}

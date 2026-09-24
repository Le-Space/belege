// "Portal öffnen": only a host written out in the purpose (or stored with the
// partner), always https, never anything a third party could smuggle in.
import { describe, expect, it } from 'vitest';

import { findPortalUrl, portalLink, safeUrl } from './portal.js';

describe('findPortalUrl', () => {
	it('a www. host with a path, as vendors write it', () => {
		expect(
			findPortalUrl('SVWZ+Kd-Nr. 123 Ihre Rechnung finden Sie unter www.vodafone.de/meinkabel.')
		).toEqual({ url: 'https://www.vodafone.de/meinkabel', host: 'www.vodafone.de' });
		expect(findPortalUrl('siehe WWW.Telekom.DE/rechnung')).toEqual({
			url: 'https://www.telekom.de/rechnung',
			host: 'www.telekom.de'
		});
	});

	it('an explicit http(s) URL: https, no query, no fragment', () => {
		expect(findPortalUrl('Rechnung: https://kundenportal.stromwerk.de/login?x=1#a')).toEqual({
			url: 'https://kundenportal.stromwerk.de/login',
			host: 'kundenportal.stromwerk.de'
		});
		expect(findPortalUrl('http://portal.beispiel.com')?.url).toBe('https://portal.beispiel.com');
	});

	it('nothing that is not a web address of a known kind', () => {
		for (const text of [
			'javascript:alert(1)',
			'javascript://www.vodafone.de/%0Aalert(1)',
			'data:text/html,<script>alert(1)</script>',
			'rechnung@vodafone.de',
			'Rechnung.pdf',
			'Abschlag.Vertrag 123',
			'vodafone.de/meinkabel',
			'http://127.0.0.1/admin',
			'https://evil.example/login',
			'https://user:pw@www.vodafone.de/',
			'https://evil.example@vodafone.de/',
			'www.-bad-.de',
			'',
			null
		]) {
			expect(findPortalUrl(text), String(text)).toBeNull();
		}
	});
});

describe('portalLink', () => {
	it('the purpose first, else a partner of the same name with a stored portal', () => {
		const partners = [
			{ name: 'Stromwerk Test AG', portalUrl: 'http://kunden.stromwerk.de/rechnungen' },
			{ name: 'Böse GmbH', portalUrl: 'javascript:alert(1)' }
		];
		expect(
			portalLink({ counterparty: 'Stromwerk Test AG', purpose: 'Abschlag' }, partners)
		).toEqual({
			url: 'https://kunden.stromwerk.de/rechnungen',
			host: 'kunden.stromwerk.de',
			from: 'partner'
		});
		expect(
			portalLink(
				{ counterparty: 'Stromwerk Test AG', purpose: 'Infos unter www.stromwerk.de/app' },
				partners
			)?.from
		).toBe('purpose');
		expect(portalLink({ counterparty: 'Böse GmbH', purpose: '' }, partners)).toBeNull();
		expect(portalLink({ counterparty: '', purpose: '' }, partners)).toBeNull();
	});

	it('safeUrl refuses ports, odd paths and other schemes', () => {
		expect(safeUrl('https://www.vodafone.de:8443/')).toBeNull();
		expect(safeUrl('https://www.vodafone.de/a b')).toBeNull();
		expect(safeUrl('ftp://www.vodafone.de/')).toBeNull();
		expect(safeUrl('https://www.vodafone.de/')).toEqual({
			url: 'https://www.vodafone.de',
			host: 'www.vodafone.de'
		});
	});
});

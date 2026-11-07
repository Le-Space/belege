import { describe, it, expect } from 'vitest';
import { canDownload, downloadName } from './download.js';

describe('the name a receipt is saved as (#709)', () => {
	it('its own name, as it is', () => {
		expect(downloadName({ fileName: 'Rechnung 2026-05.pdf', mime: 'application/pdf' })).toBe(
			'Rechnung 2026-05.pdf'
		);
	});

	it('its last path segment only, no control characters, no characters a file system refuses', () => {
		expect(
			downloadName({ fileName: '../../etc/pass\u0000wd:*?.pdf', mime: 'application/pdf' })
		).toBe('pass wd.pdf');
		expect(downloadName({ fileName: '..\\..\\x.pdf', mime: 'application/pdf' })).toBe('x.pdf');
	});

	it('the extension from its type when the name lacks it', () => {
		expect(downloadName({ fileName: 'scan', mime: 'image/jpeg' })).toBe('scan.jpg');
		expect(downloadName({ fileName: 'Rechnung.PDF', mime: 'application/pdf' })).toBe(
			'Rechnung.pdf'
		);
	});

	it('without a name: the day and the vendor', () => {
		expect(
			downloadName({
				fileName: null,
				mime: 'application/pdf',
				documentDate: '2026-05-04',
				vendor: 'Wolkenfabrik Hosting GmbH'
			})
		).toBe('2026-05-04 Wolkenfabrik Hosting GmbH.pdf');
		expect(downloadName({ mime: 'application/xml' })).toBe('Beleg.xml');
	});

	it('an unknown type keeps the name’s own extension', () => {
		expect(downloadName({ fileName: 'daten.csv', mime: 'text/csv' })).toBe('daten.csv');
	});

	it('a long name is cut, its extension kept', () => {
		const name = downloadName({ fileName: `${'a'.repeat(300)}.pdf`, mime: 'application/pdf' });
		expect(name).toBe(`${'a'.repeat(120)}.pdf`);
	});
});

describe('which receipts can be saved (#709)', () => {
	it('one with a file; not a mail’s text alone, not one from a sender still to be confirmed', () => {
		expect(canDownload({ fileCid: 'bafy', source: 'upload' })).toBe(true);
		expect(canDownload({ fileCid: null, excerpt: 'Text', source: 'mail' })).toBe(false);
		expect(canDownload({ fileCid: 'bafy', source: 'mail', authVerdict: 'fail' })).toBe(false);
		expect(
			canDownload({ fileCid: 'bafy', source: 'mail', authVerdict: 'fail', confirmedByUser: true })
		).toBe(true);
	});
});

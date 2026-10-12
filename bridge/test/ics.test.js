// Appointments from invitations (issue #213, step 4c): the calendar part of
// a mail, read for its title, place and times only. Everything here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultConfig } from '../src/config.js';
import { createMailClient } from '../src/mail/imap.js';
import { parseIcs } from '../src/mail/ics.js';
import { calendarParts } from '../src/mail/mime.js';
import {
	FAKE_IMAP_PASSWORD,
	INVITATION,
	sampleMailbox,
	startFakeImap
} from './support/fake-imap.js';

/** @param {string[]} lines */
const ics = (lines) => ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n');
/** @param {string[]} lines */
const event = (lines) => ics(['BEGIN:VEVENT', ...lines, 'END:VEVENT']);

test('an appointment: title, place, times in its own zone; escapes undone, folded lines joined', () => {
	assert.deepEqual(
		parseIcs(
			event([
				'SUMMARY:Messe Beispiel\\, Halle 3',
				'LOCATION:Messegelände Musterstadt\\; Eingang ',
				' Süd',
				'DTSTART;TZID=Europe/Berlin:20261105T093000',
				'DTEND;TZID=Europe/Berlin:20261105T171500'
			])
		),
		[
			{
				summary: 'Messe Beispiel, Halle 3',
				location: 'Messegelände Musterstadt; Eingang Süd',
				start: '2026-11-05T09:30',
				end: '2026-11-05T17:15',
				allDay: false,
				cancelled: false
			}
		]
	);
});

test('UTC as in Germany, summer and winter; a floating time as written; a duration', () => {
	const [summer] = parseIcs(
		event(['SUMMARY:A', 'DTSTART:20260610T070000Z', 'DTEND:20260610T080000Z'])
	);
	assert.deepEqual([summer.start, summer.end], ['2026-06-10T09:00', '2026-06-10T10:00']);
	const [winter] = parseIcs(event(['SUMMARY:B', 'DTSTART:20261210T230000Z']));
	assert.deepEqual([winter.start, winter.end], ['2026-12-11T00:00', '2026-12-11T00:00']);
	const [floating] = parseIcs(event(['SUMMARY:C', 'DTSTART:20261105T093000', 'DURATION:PT2H30M']));
	assert.deepEqual([floating.start, floating.end], ['2026-11-05T09:30', '2026-11-05T12:00']);
});

test('all day: the end is exclusive in the format, the last day here', () => {
	const [days] = parseIcs(
		event(['SUMMARY:Kongress', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261108'])
	);
	assert.deepEqual([days.start, days.end, days.allDay], ['2026-11-05', '2026-11-07', true]);
	const [one] = parseIcs(event(['SUMMARY:Tag', 'DTSTART;VALUE=DATE:20261105']));
	assert.deepEqual([one.start, one.end], ['2026-11-05', '2026-11-05']);
});

test('cancelled, broken, too many', () => {
	assert.equal(
		parseIcs(
			ics(['METHOD:CANCEL', 'BEGIN:VEVENT', 'SUMMARY:X', 'DTSTART:20261105T093000', 'END:VEVENT'])
		)[0].cancelled,
		true
	);
	assert.equal(
		parseIcs(event(['SUMMARY:Y', 'STATUS:CANCELLED', 'DTSTART:20261105T093000']))[0].cancelled,
		true
	);
	assert.deepEqual(parseIcs(event(['SUMMARY:Ohne Beginn'])), []);
	assert.deepEqual(parseIcs(event(['SUMMARY:Unsinn', 'DTSTART:20261105T253000'])), []);
	assert.deepEqual(parseIcs('kein Kalender'), []);
	const many = ics(
		Array.from({ length: 9 }, (_, i) => [
			'BEGIN:VEVENT',
			`SUMMARY:Termin ${i}`,
			`DTSTART:2026110${i}T090000`,
			'END:VEVENT'
		]).flat()
	);
	assert.equal(parseIcs(many).length, 5);
});

test('nothing of the people: organiser, attendees, description and links are not read', () => {
	const [a] = parseIcs(INVITATION.ics);
	const all = JSON.stringify(a);
	for (const secret of [INVITATION.organizer, INVITATION.attendee, 'geheimtoken', 'mailto']) {
		assert.ok(!all.includes(secret), secret);
	}
	assert.deepEqual(Object.keys(a).sort(), [
		'allDay',
		'cancelled',
		'end',
		'location',
		'start',
		'summary'
	]);
});

test('calendar parts of a mail: text/calendar, application/ics or a .ics file, inline or attached', () => {
	const tree = {
		type: 'multipart/mixed',
		childNodes: [
			{
				part: '1',
				type: 'multipart/alternative',
				childNodes: [
					{ part: '1.1', type: 'text/plain' },
					{ part: '1.2', type: 'text/calendar', size: 900 }
				]
			},
			{
				part: '2',
				type: 'application/octet-stream',
				disposition: 'attachment',
				dispositionParameters: { filename: 'invite.ICS' },
				size: 800
			},
			{ part: '3', type: 'application/pdf', disposition: 'attachment', size: 9000 }
		]
	};
	assert.deepEqual(calendarParts(tree), [
		{ part: '1.2', size: 900 },
		{ part: '2', size: 800 }
	]);
});

test('listed mails carry their appointments, and only title, place and times', async () => {
	const imap = await startFakeImap({ storage: sampleMailbox({ invitation: true }) });
	try {
		const mail = createMailClient({
			config: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none'
			},
			getPassword: async () => FAKE_IMAP_PASSWORD
		});
		const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
		const messages = await mail.listMessages({ since });
		const invite = messages.find((m) => m.subject === 'Einladung: Fachtagung Beispiel');
		assert.ok(invite, 'the invitation is listed');
		assert.deepEqual(invite.calendar, [
			{
				summary: 'Fachtagung Beispiel 2026',
				location: 'Kongresshaus Musterstadt, Saal 2',
				start: '2026-11-05T09:30',
				end: '2026-11-05T17:15',
				allDay: false,
				cancelled: false
			}
		]);
		const listed = JSON.stringify(messages);
		assert.ok(!listed.includes(INVITATION.organizer) && !listed.includes('geheimtoken'));
		// Every other mail says it has none.
		assert.ok(messages.filter((m) => m !== invite).every((m) => m.calendar.length === 0));
	} finally {
		await imap.close();
	}
});

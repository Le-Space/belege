// Appointments from invitations (issue #213, step 4c): the calendar parts of
// the mails the bridge lists from the accounting address (bridge/src/mail/
// ics.js) – a conference, a fair, a customer's meeting – kept as records of
// kind `appointment` in the sealed travel collection. Title, place and times
// only; nobody's name or address.
//
// An appointment is no receipt and proposes no trip by itself: most meetings
// are at home, and the books cannot tell where home is. It gives a trip its
// occasion and its days – in a proposal whose days it falls into
// (proposals.js), on the trip's page, and on Reisen with "Reise dazu
// anlegen" for one somewhere else, a click away. An appointment without a
// place, or online, never hints at a trip.

/** @typedef {Record<string, any>} Rec */

const ONLINE =
	/^(?:https?:\/\/|www\.)|\b(?:online|zoom|teams|meet\.google|google meet|webex|jitsi|skype|whereby|virtual|virtuell|videokonferenz|video call)\b/i;

/** Whether an appointment is somewhere to go to: a place, not a link or a call. @param {Rec} a */
export const isOnSite = (a) => Boolean(String(a.location ?? '').trim()) && !ONLINE.test(a.location);

/** Its first and last day. @param {Rec} a */
export const appointmentDays = (a) => ({
	fromDay: String(a.start).slice(0, 10),
	toDay: String(a.end || a.start).slice(0, 10)
});

/**
 * The appointments that count: not deleted, not cancelled; earliest first.
 *
 * @param {Rec[]} travel the travel collection's
 */
export const allAppointments = (travel) =>
	travel
		.filter((r) => r.kind === 'appointment' && !r.deleted && !r.cancelled)
		.sort((a, b) => String(a.start).localeCompare(String(b.start)));

/**
 * The on-site appointments on some days.
 *
 * @param {Rec[]} travel
 * @param {string} fromDay
 * @param {string} toDay
 */
export const appointmentsOn = (travel, fromDay, toDay) =>
	allAppointments(travel).filter((a) => {
		const d = appointmentDays(a);
		return isOnSite(a) && d.fromDay <= toDay && fromDay <= d.toDay;
	});

/**
 * A trip's head from an appointment: its place as the destination, its
 * title as the occasion, its times – the journey there and back is put
 * right on the trip's page. All day: 8 to 18.
 *
 * @param {Rec} a
 */
export function tripFromAppointment(a) {
	const { fromDay, toDay } = appointmentDays(a);
	return {
		destination: String(a.location ?? '').trim(),
		reason: String(a.summary ?? '').trim(),
		start: a.allDay ? `${fromDay}T08:00` : a.start,
		end: a.allDay ? `${toDay}T18:00` : a.end > a.start ? a.end : `${toDay}T18:00`
	};
}

/**
 * The appointments of the listed mails into the travel collection: new ones
 * written, a cancellation noted on one already there. Each by its mail and
 * its place in the mail, so a second fetch writes nothing.
 *
 * @param {import('../store/repository.js').Collection} travel
 * @param {any[]} messages from GET /mail/messages
 * @returns {Promise<{ new: number, cancelled: number }>}
 */
export async function importAppointments(travel, messages) {
	const known = new Map(
		(await travel.list({ includeDeleted: true, where: (r) => r.kind === 'appointment' })).map(
			(r) => [String(r.ref), r]
		)
	);
	const counts = { new: 0, cancelled: 0 };
	for (const m of messages) {
		const list = Array.isArray(m.calendar) ? m.calendar : [];
		for (const [i, a] of list.entries()) {
			if (!a || typeof a.start !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(a.start)) continue;
			const ref = `${m.id}#${i}`;
			const before = known.get(ref);
			if (before) {
				if (a.cancelled === true && !before.cancelled) {
					await travel.put({ ...before, cancelled: true });
					counts.cancelled++;
				}
				continue;
			}
			await travel.put({
				kind: 'appointment',
				ref,
				mailId: String(m.id),
				summary: String(a.summary ?? '').slice(0, 200),
				location: String(a.location ?? '').slice(0, 200),
				start: a.start,
				end: typeof a.end === 'string' && a.end ? a.end : a.start,
				allDay: a.allDay === true,
				cancelled: a.cancelled === true
			});
			counts.new++;
		}
	}
	return counts;
}

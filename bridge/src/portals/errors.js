// Errors of the portal connector. Their messages are the bridge's own: never
// page content, never a user name or password. `step` names the recipe step
// that failed, so a broken selector can be reported without a screenshot.

export class PortalError extends Error {
	/**
	 * @param {string} message
	 * @param {string} code
	 * @param {number} status
	 * @param {{ step?: string, reason?: string }} [extra]
	 */
	constructor(message, code, status, extra = {}) {
		super(message);
		this.name = 'PortalError';
		this.code = code;
		this.status = status;
		this.step = extra.step ?? null;
		this.reason = extra.reason ?? null;
	}
}

/** @param {string} id */
export const unknownPortal = (id) =>
	new PortalError(`Unknown portal ${JSON.stringify(id).slice(0, 40)}.`, 'PORTAL_UNKNOWN', 404);

/** @param {string} id */
export const busy = (id) =>
	new PortalError(`Portal ${id} is busy with another run.`, 'PORTAL_BUSY', 409);

/**
 * @param {string} id
 * @param {string} [reason] otp, captcha, rejected, unknown, expired
 */
export const needsLogin = (id, reason = 'expired') =>
	new PortalError(`Portal ${id} needs a login in the visible window.`, 'PORTAL_NEEDS_LOGIN', 409, {
		reason
	});

/**
 * A recipe step did not work, most likely because the portal changed.
 *
 * @param {string} id
 * @param {string} step
 */
export const stepFailed = (id, step) =>
	new PortalError(
		`Portal ${id}: step "${step}" failed. The portal may have changed; see bridge/README.md "Kundenportale".`,
		'PORTAL_STEP_FAILED',
		502,
		{ step }
	);

// SPDX-License-Identifier: AGPL-3.0-or-later
// A command and its arguments ↔ what HTTP carries: the path with its `{name}`
// filled in, the query, or the JSON body (catalogue.js `args`).
//
//   httpRequest('bank.transactions', { account: 'a1', since: '2026-10-01' })
//     → { method: 'GET', path: '/hibiscus/transactions?account=a1&since=2026-10-01', body: null }
//
// `commandInput` is the other way, for a command that arrives by name over
// the stream: the arguments as the bridge's commands read them (`query`,
// `params`, `body`), so a command runs the same whichever way it came.

import { command } from './catalogue.js';

/** @param {string} name */
function specOf(name) {
	const spec = command(name);
	if (!spec) throw new Error(`unknown bridge command: ${name}`);
	return spec;
}

/** The `{name}` placeholders of a path. @param {string} path */
export const pathParams = (path) => [...path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);

/**
 * Split the arguments: the path's own, the rest.
 *
 * @param {string} path
 * @param {Record<string, unknown>} args
 */
function split(path, args) {
	const names = pathParams(path);
	/** @type {Record<string, string>} */
	const params = {};
	/** @type {Record<string, unknown>} */
	const rest = {};
	for (const [key, value] of Object.entries(args ?? {})) {
		if (names.includes(key)) params[key] = String(value);
		else rest[key] = value;
	}
	for (const name of names) {
		if (params[name] === undefined) throw new Error(`${name} is required in the path`);
	}
	return { params, rest };
}

/**
 * The arguments as a query: strings, a list as the key repeated, null and
 * undefined left out.
 *
 * @param {Record<string, unknown>} args
 */
export function toQuery(args) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) for (const v of value) query.append(key, String(v));
		else query.set(key, String(value));
	}
	return query;
}

/**
 * How HTTP carries a command: method, path with its query, and the JSON body
 * (null without one; the bytes of a `bytes` command are the caller's).
 *
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {{ method: 'GET' | 'POST' | 'DELETE', path: string, body: string | null }}
 */
export function httpRequest(name, args = {}) {
	const spec = specOf(name);
	const { params, rest } = split(spec.path, args);
	const path = spec.path.replace(/\{([a-zA-Z]+)\}/g, (_, key) => encodeURIComponent(params[key]));
	if (spec.args === 'json') return { method: spec.method, path, body: JSON.stringify(rest) };
	if (spec.args === 'none') return { method: spec.method, path, body: null };
	const query = toQuery(rest).toString();
	return {
		method: spec.method,
		path: query ? `${path}?${query}` : path,
		body: null
	};
}

/**
 * What a command reads when it arrives by name: the query, the path's
 * parameters and the JSON body, as HTTP would have given them.
 *
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {{ query: URLSearchParams, params: Record<string, string>, body: Record<string, unknown> }}
 */
export function commandInput(name, args = {}) {
	const spec = specOf(name);
	const { params, rest } = split(spec.path, args);
	if (spec.args === 'json') return { query: new URLSearchParams(), params, body: rest };
	if (spec.args === 'none') return { query: new URLSearchParams(), params, body: {} };
	return { query: toQuery(rest), params, body: {} };
}

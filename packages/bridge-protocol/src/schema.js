// SPDX-License-Identifier: AGPL-3.0-or-later
// A small JSON Schema check for the bridge's commands: the subset the
// catalogue uses, in a browser and in Node, with no code generation (no
// `new Function`, so a Content-Security-Policy without 'unsafe-eval' holds).
//
// Supported: type (one or a list), enum, const, pattern, minLength,
// maxLength, minimum, maximum, properties, required, additionalProperties
// (false or a schema), items, minItems, maxItems. Anything else in a schema
// is a description and is ignored.

/**
 * @typedef {object} Schema
 * @property {string | string[]} [type] string, integer, number, boolean, object, array, null
 * @property {unknown[]} [enum]
 * @property {unknown} [const]
 * @property {string} [pattern] a regular expression the whole string must match (anchor it)
 * @property {number} [minLength]
 * @property {number} [maxLength]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {Record<string, Schema>} [properties]
 * @property {string[]} [required]
 * @property {boolean | Schema} [additionalProperties] true when left out
 * @property {Schema} [items]
 * @property {number} [minItems]
 * @property {number} [maxItems]
 * @property {string} [description]
 */

/** How deep a value may nest before it is refused, whatever the schema. */
const MAX_DEPTH = 32;
/** At most this many problems are named. */
const MAX_PROBLEMS = 10;

/** @param {unknown} value */
function typeOf(value) {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/** @param {unknown} value @param {string} type */
function isType(value, type) {
	switch (type) {
		case 'integer':
			return Number.isSafeInteger(value);
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'object':
			return typeOf(value) === 'object';
		default:
			return typeOf(value) === type;
	}
}

/** @type {Map<string, RegExp>} */
const patterns = new Map();
/** @param {string} source */
function regex(source) {
	let r = patterns.get(source);
	if (!r) {
		r = new RegExp(source, 'u');
		patterns.set(source, r);
	}
	return r;
}

/**
 * The problems of `value` against `schema`; [] when it fits. Each problem
 * names where (`booking.amount`) and what, never the value itself: a
 * problem may end up in a log.
 *
 * @param {Schema} schema
 * @param {unknown} value
 * @returns {string[]}
 */
export function check(schema, value) {
	/** @type {string[]} */
	const problems = [];
	walk(schema, value, '', 0, problems);
	return problems;
}

/**
 * @param {Schema} schema
 * @param {unknown} value
 * @param {string} at
 * @param {number} depth
 * @param {string[]} problems
 */
function walk(schema, value, at, depth, problems) {
	if (problems.length >= MAX_PROBLEMS) return;
	const where = at || 'the arguments';
	if (depth > MAX_DEPTH) {
		problems.push(`${where}: nested too deep`);
		return;
	}
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some((t) => isType(value, t))) {
			problems.push(`${where}: must be ${types.join(' or ')}`);
			return;
		}
	}
	if (schema.const !== undefined && value !== schema.const) {
		problems.push(`${where}: must be ${JSON.stringify(schema.const)}`);
		return;
	}
	if (schema.enum && !schema.enum.includes(value)) {
		problems.push(
			`${where}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`
		);
		return;
	}
	if (typeof value === 'string') {
		const length = [...value].length;
		if (schema.minLength !== undefined && length < schema.minLength)
			problems.push(`${where}: at least ${schema.minLength} characters`);
		if (schema.maxLength !== undefined && length > schema.maxLength)
			problems.push(`${where}: at most ${schema.maxLength} characters`);
		if (schema.pattern !== undefined && !regex(schema.pattern).test(value))
			problems.push(`${where}: not in the expected form`);
	}
	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum)
			problems.push(`${where}: at least ${schema.minimum}`);
		if (schema.maximum !== undefined && value > schema.maximum)
			problems.push(`${where}: at most ${schema.maximum}`);
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems)
			problems.push(`${where}: at least ${schema.minItems} entries`);
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			problems.push(`${where}: at most ${schema.maxItems} entries`);
			return;
		}
		if (schema.items) {
			const items = schema.items;
			value.forEach((v, i) => walk(items, v, `${at}[${i}]`, depth + 1, problems));
		}
	}
	if (typeOf(value) === 'object') {
		const object = /** @type {Record<string, unknown>} */ (value);
		for (const key of schema.required ?? []) {
			if (object[key] === undefined) problems.push(`${at ? `${at}.` : ''}${key}: required`);
		}
		const properties = schema.properties ?? {};
		for (const [key, v] of Object.entries(object)) {
			const path = at ? `${at}.${key}` : key;
			const own = Object.hasOwn(properties, key) ? properties[key] : undefined;
			if (own) {
				if (v !== undefined) walk(own, v, path, depth + 1, problems);
			} else if (schema.additionalProperties === false) {
				problems.push(`${path}: not expected`);
			} else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
				walk(schema.additionalProperties, v, path, depth + 1, problems);
			}
		}
	}
}

// Terminal prompts for the setup CLI. `askHidden` echoes nothing.

import readline from 'node:readline';

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
export function ask(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Read a line without echoing it. Needs a TTY: a password is never read from
 * a pipe, where it would have come from a file or another process.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export function askHidden(question) {
	const stdin = process.stdin;
	if (!stdin.isTTY) {
		return Promise.reject(new Error('A password prompt needs a terminal (stdin is not a TTY).'));
	}
	process.stdout.write(question);
	return new Promise((resolve, reject) => {
		let value = '';
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		const done = (/** @type {Error | null} */ error) => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off('data', onData);
			process.stdout.write('\n');
			if (error) reject(error);
			else resolve(value);
		};
		const onData = (/** @type {string} */ chunk) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') return done(null);
				if (ch === '\u0003') return done(new Error('Cancelled.'));
				if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
				else if (ch >= ' ') value += ch;
			}
		};
		stdin.on('data', onData);
	});
}

// Terminal prompts for the setup CLI. `askHidden` echoes nothing.
//
// One readline interface serves every question of a run. Opening a fresh one
// per question, and switching the terminal to raw mode for the password, lost
// whatever was typed or pasted in between: a password entered right after the
// previous Enter came through empty, or with its first characters missing.
// Readline also understands a terminal's bracketed paste, so a pasted password
// arrives without the `ESC[200~ … ESC[201~` markers around it.

import readline from 'node:readline';

/** @type {readline.Interface | null} */
let rl = null;
let muted = false;
/** Lines that came before anyone asked for them, and askers waiting for a line. */
/** @type {string[]} */ let lines = [];
/** @type {((line: string) => void)[]} */ let waiting = [];

function session() {
	if (rl) return rl;
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: Boolean(process.stdin.isTTY),
		historySize: 0 // no answer, least of all the password, is kept for arrow-up
	});
	// Ctrl+C ends the setup; without a listener readline would only pause.
	rl.on('SIGINT', () => {
		process.stdout.write('\nCancelled.\n');
		process.exit(130);
	});
	// Every line is kept until a question takes it: `rl.question` drops lines
	// that arrive while no question is pending, e.g. several answers in one paste.
	rl.on('line', (line) => {
		const next = waiting.shift();
		if (next) next(line);
		else lines.push(line);
	});
	// While muted, readline's own echo of each keystroke goes nowhere.
	const write = /** @type {any} */ (rl)._writeToOutput.bind(rl);
	/** @type {any} */ (rl)._writeToOutput = (/** @type {string} */ text) => {
		if (!muted) write(text);
	};
	return rl;
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function ask(question) {
	session();
	process.stdout.write(question);
	return (await nextLine()).trim();
}

/** @returns {Promise<string>} */
function nextLine() {
	const line = lines.shift();
	if (line !== undefined) return Promise.resolve(line);
	return new Promise((resolve) => waiting.push(resolve));
}

/**
 * Read a line without echoing it. Needs a TTY: a password is never read from
 * a pipe, where it would have come from a file or another process.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export function askHidden(question) {
	if (!process.stdin.isTTY) {
		return Promise.reject(new Error('A password prompt needs a terminal (stdin is not a TTY).'));
	}
	session();
	process.stdout.write(question);
	muted = true;
	return nextLine().then((answer) => {
		muted = false;
		process.stdout.write('\n');
		return answer;
	});
}

/** Lets the process end: an open interface keeps stdin, and so the process, alive. */
export function closePrompts() {
	rl?.close();
	rl = null;
	muted = false;
	lines = [];
	waiting = [];
}

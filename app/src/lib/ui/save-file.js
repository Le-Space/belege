// Hands bytes to the browser as a download: a Blob and a click, nothing sent
// anywhere. The address of the Blob is given up a minute later.

/**
 * @param {Blob} blob
 * @param {string} fileName
 */
export function saveFile(blob, fileName) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

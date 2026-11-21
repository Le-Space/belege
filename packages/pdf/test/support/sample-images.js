// SPDX-License-Identifier: AGPL-3.0-or-later
// Two made-up logos for tests (@le-space/pdf/testing/sample-images): a blue
// disc with a white bar and three grey blocks, 240 × 80 pixels. The PNG has
// a transparent ground and a half-transparent rim; the JPEG is the same
// picture on white as macOS wrote it, with an EXIF segment a document must
// not carry on. No company's mark: drawn by a script for this file.

/** @param {string} b64 */
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAPAAAABQBAMAAADVZ+VPAAAAD1BMVEUAAAAqeNYqeNZGRkb///+77EmgAAAABXRS' +
	'TlMAgP///y+MlpgAAAEGSURBVHic7ZnRDYMwDEQTdYGmGyTqBl2h+8/UiCCU4jh8IPuk2PfBB3w8+WQFuAvB5XJJ' +
	'Ke166mLjBs3bVZn7Kk2q5HhgGxrD1SOfuWpkwq1kjd2OiXBLVhiZGq1k9pCrYPbIaBWz43jgOrIwmBm4jizrNee0' +
	'uNfMasmvFzuwsNfsap3W6/Ehag/o/asHYPDE6T+vlwFPne69XgY8dbr32sE3wfxBvYOTFHi+W912LQZ+f6kc7OCb' +
	'4HIBzstN7GArYNhZDQCj3sf2Pn1wYHsf9PZ+2gz+mMMyEFzqA8u5YMkeLsuEpbewvBqX0MM6CVwLg+udYE0brlvE' +
	'tam4/jjAGnOXawH9AA08hD5XmsQ0AAAAAElFTkSuQmCC';

const JPEG =
	'/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAAB' +
	'AAEAAKACAAQAAAABAAAA8KADAAQAAAABAAAAUAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklN' +
	'BCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAUADwAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAAB' +
	'AgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNi' +
	'coIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SV' +
	'lpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8B' +
	'AAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXET' +
	'IjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpz' +
	'dHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm' +
	'5+jp6vLz9PX29/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJCQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUV' +
	'FRkZGRkZHBwcHBwcHBwcHP/bAEMBBAUFBwcHDAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0d' +
	'HR0dHR0dHR0dHR0dHR0dHR0dHf/dAAQAD//aAAwDAQACEQMRAD8A+/qKKKACiuD8X+PdK8K2ryFlnmGRtByFbkAH' +
	'HVsj7vHAJJA5r5i8S/FTxDr0xEMn2eBWyq4B6FsfKcqOD6Fv9oivcwOTYjFLmStHuzycXmlHD+69X2R9j/21o/8A' +
	'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' +
	'oAKKKKACiiigAooooAKKKKAP/9k=';

/** The logo as a PNG file with transparency. @returns {Uint8Array} */
export const samplePng = () => bytes(PNG);
/** The logo as a JPEG file with an EXIF segment. @returns {Uint8Array} */
export const sampleJpeg = () => bytes(JPEG);

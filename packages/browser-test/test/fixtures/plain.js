// A scenario that runs anywhere.
export default async () => ({
	hex: Array.from(new TextEncoder().encode('x'), (b) => b.toString(16))
});

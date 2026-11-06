// A scenario that uses Node's Buffer global: the page must fail.
export default async () => Buffer.from('x').toString('hex');

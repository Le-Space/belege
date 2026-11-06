// A scenario that would only run in Node: the browser build must refuse it.
import { createHash } from 'node:crypto';

export default async () => createHash('sha256').update('x').digest('hex');

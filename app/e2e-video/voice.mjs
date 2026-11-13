// The narrator from the command line: `node e2e-video/voice.mjs voices`
// lists the voices the key can use, `node e2e-video/voice.mjs "a line"`
// speaks one into e2e-video/voice/.
import { voiceCli } from '@le-space/video-kit/voice';
import { voice } from './belege.js';

await voiceCli(voice, process.argv.slice(2));

// Manual fallback for a closed paid campaign if host shutdown interrupted its wrapper.
import {parseArgs} from 'node:util';
import {writeHeldRecord} from './support.mjs';
const {positionals} = parseArgs({allowPositionals: true});
if (positionals.length !== 1) throw new Error('Use export-held.mjs <closed paid campaign directory>. No PLC contact.');
console.log(JSON.stringify(writeHeldRecord(positionals[0])));

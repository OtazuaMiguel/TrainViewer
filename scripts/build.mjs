// Genera index.html (autocontenido) a partir de src/app.html + src/geodata.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src/app.html'), 'utf8');
const geo = JSON.stringify(JSON.parse(readFileSync(join(root, 'src/geodata.json'), 'utf8')));
const MARK = '/*__EMBED__*/null';
if (!app.includes(MARK)) throw new Error(`No se encuentra el marcador ${MARK} en src/app.html`);
const out = app.replace(MARK, () => geo);
const dest = resolve(root, process.argv[2] || 'index.html');
writeFileSync(dest, out);
console.log(`${dest} generado (${(out.length / 1024).toFixed(0)} KB)`);

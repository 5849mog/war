import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const required = ['index.html', 'manifest.webmanifest', 'assets/brand-mark.svg', 'src/main.mjs', 'src/ui/app.css'];
for (const path of required) await access(resolve(root, path));

async function collectModules(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) result.push(...await collectModules(path));
    else if (extname(path) === '.mjs') result.push(path);
  }
  return result;
}

const modules = await collectModules(resolve(root, 'src'));
for (const modulePath of modules) {
  const code = await readFile(modulePath, 'utf8');
  const specifiers = [...code.matchAll(/(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g)].map((match) => match[2]);
  for (const specifier of specifiers) await access(resolve(dirname(modulePath), specifier));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'manifest.webmanifest', 'assets', 'src']) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}
const packageInfo = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(resolve(output, 'build-info.json'), JSON.stringify({
  package: packageInfo.name,
  version: packageInfo.version,
  contentVersion: '0.6.0',
  target: 'mobile-browser-landscape',
  mode: 'static-es-modules',
}, null, 2) + '\n');
console.log('Built ' + relative(root, output) + ' (' + modules.length + ' JavaScript modules).');

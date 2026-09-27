import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rustTarget } from './platform.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { target: { type: 'string' }, output: { type: 'string' } } });
const target = rustTarget(values.target);
const output = values.output ? path.resolve(values.output) : path.join(root, 'docs', 'THIRD-PARTY-NOTICES.txt');
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const app = await json(path.join(root, 'package.json'));
const npmLock = await json(path.join(root, 'package-lock.json'));
const metadataProcess = spawnSync('cargo', ['metadata', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml'), '--format-version', '1', '--locked', '--offline', '--filter-platform', target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: root, windowsHide: true });
if (metadataProcess.error) throw metadataProcess.error;
if (metadataProcess.status !== 0) throw new Error(metadataProcess.stderr || `cargo metadata exited ${metadataProcess.status}`);
const metadata = JSON.parse(metadataProcess.stdout);
const records = [];
const missing = [];
const legalName = /^(?:licen[cs]e|notice|copying|copyright)(?:$|[._-])|(?:^|[._-])licen[cs]e(?:$|[._-])/i;

async function legalFiles(directory, declaredLicense = null) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = entries.filter(entry => entry.isFile() && legalName.test(entry.name)).map(entry => path.join(directory, entry.name));
  for (const entry of entries.filter(entry => entry.isDirectory() && /^(?:licen[cs]es?|notices?)$/i.test(entry.name))) {
    const folder = path.join(directory, entry.name);
    for (const child of await readdir(folder, { withFileTypes: true })) {
      if (child.isFile()) candidates.push(path.join(folder, child.name));
    }
  }
  if (declaredLicense) candidates.push(path.resolve(directory, declaredLicense));
  const collected = [];
  for (const filename of [...new Set(candidates)].sort()) {
    if (!filename.startsWith(`${directory}${path.sep}`)) throw new Error(`License path is outside dependency directory: ${filename}`);
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) continue;
    if (info.size > 1024 * 1024) throw new Error(`Unexpectedly large license file: ${filename}`);
    const contents = (await readFile(filename, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
    if (contents.includes('\u0000')) throw new Error(`Unexpected binary license file: ${filename}`);
    collected.push({ filename: path.relative(directory, filename).split(path.sep).join('/'), contents });
  }
  return collected;
}

function repository(value) {
  if (typeof value === 'string') return value;
  return value?.url ?? null;
}

async function resolveNpmDirectory(name, parent) {
  let directory = parent;
  while (true) {
    const candidate = path.join(directory, 'node_modules', ...name.split('/'));
    if (await stat(path.join(candidate, 'package.json')).then(value => value.isFile()).catch(() => false)) return realpath(candidate);
    const next = path.dirname(directory);
    if (next === directory) throw new Error(`Installed npm package not found: ${name} from ${parent}`);
    directory = next;
  }
}

const visitedNpm = new Set();
async function collectNpm(name, parent, purpose) {
  const directory = await resolveNpmDirectory(name, parent);
  if (visitedNpm.has(directory)) return;
  visitedNpm.add(directory);
  const manifest = await json(path.join(directory, 'package.json'));
  const installedPath = path.relative(root, directory).split(path.sep).join('/');
  const lockEntry = npmLock.packages?.[installedPath];
  const files = await legalFiles(directory);
  const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? manifest.licenses?.map(item => item.type).join(' OR ') ?? 'Not declared';
  const record = { ecosystem: 'npm', name: manifest.name, version: manifest.version, license, purpose, repository: repository(manifest.repository) ?? manifest.homepage, distribution: `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`, archive: lockEntry?.resolved, files };
  records.push(record);
  if (!files.length) missing.push(`${record.ecosystem} ${record.name}@${record.version}: ${license}`);
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) await collectNpm(dependency, directory, 'Runtime dependency');
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
    try { await collectNpm(dependency, directory, 'Optional runtime dependency installed locally'); } catch (error) {
      if (!String(error.message).startsWith('Installed npm package not found:')) throw error;
    }
  }
}

for (const dependency of Object.keys(app.dependencies ?? {}).sort()) await collectNpm(dependency, root, 'Application runtime dependency');
for (const dependency of ['daisyui', 'tailwindcss']) await collectNpm(dependency, root, 'CSS and theme dependency');

const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
const graph = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
const visitedCargo = new Set();
const queue = [metadata.resolve.root];
while (queue.length) {
  const id = queue.shift();
  if (visitedCargo.has(id)) continue;
  visitedCargo.add(id);
  const node = graph.get(id);
  if (!node) throw new Error(`Resolved Cargo node not found: ${id}`);
  for (const dependency of node.deps) {
    if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) queue.push(dependency.pkg);
  }
  if (id === metadata.resolve.root) continue;
  const pkg = packages.get(id);
  if (!pkg) throw new Error(`Cargo package metadata not found: ${id}`);
  const directory = await realpath(path.dirname(pkg.manifest_path));
  const files = await legalFiles(directory, pkg.license_file);
  const cratesIo = pkg.source?.startsWith('registry+');
  const record = { ecosystem: 'Rust', name: pkg.name, version: pkg.version, license: pkg.license ?? 'See included license file', purpose: `Native dependency or build dependency for ${target}`, repository: pkg.repository ?? pkg.homepage, distribution: cratesIo ? `https://crates.io/crates/${pkg.name}/${pkg.version}` : pkg.source, archive: cratesIo ? `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download` : pkg.source, files };
  records.push(record);
  if (!files.length) missing.push(`${record.ecosystem} ${record.name}@${record.version}: ${record.license}`);
}

records.sort((a, b) => `${a.ecosystem}:${a.name}:${a.version}`.localeCompare(`${b.ecosystem}:${b.name}:${b.version}`, 'en'));
const withoutLocalFiles = records.filter(record => !record.files.length).length;
for (const record of records.filter(record => !record.files.length)) {
  const sibling = records.find(candidate => candidate.repository && candidate.repository === record.repository && candidate.license === record.license && candidate.files.length);
  if (sibling) {
    record.sharedFrom = `${sibling.ecosystem} ${sibling.name} ${sibling.version}`;
    record.files = sibling.files.map(file => ({ ...file, filename: `${record.sharedFrom}/${file.filename}` }));
  }
}
missing.length = 0;
for (const record of records.filter(record => !record.files.length)) missing.push(`${record.ecosystem} ${record.name}@${record.version}: ${record.license}`);
const hash = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
const npmCount = records.filter(record => record.ecosystem === 'npm').length;
const rustCount = records.length - npmCount;
const sections = [
  'DF-01 Studio - Third-Party Notices',
  '================================',
  '',
  'Generated by: node scripts/generate-notices.mjs',
  `Application version: ${app.version}`,
  `Native target: ${target}`,
  `NPM package-lock.json SHA-256: ${await hash(path.join(root, 'package-lock.json'))}`,
  `Cargo.lock SHA-256: ${await hash(path.join(root, 'src-tauri', 'Cargo.lock'))}`,
  '',
  'This file reproduces license and notice files from the locally installed',
  'application JavaScript dependencies, CSS/theme dependencies, and the locked',
  `Rust normal/build dependency graph for ${target}. Development-only test tooling is`,
  'not included. Some build dependencies do not ship as executable code; their',
  'notices are retained here along with those for generated code.',
  '',
  'License expressions below are declarations from package metadata. Where a',
  'package offers alternative licenses, all license files shipped with that',
  'package are reproduced; their inclusion does not change the offered choices.',
  'Source and archive links identify the corresponding upstream versions.',
  'Dependency sources used for this distribution have not been modified.',
  'Where a crate omits standalone files but another included crate declares the',
  'same repository and license expression, those shared upstream files are',
  'reproduced with their actual source crate identified.',
  '',
  `Included packages: ${records.length} (${npmCount} npm, ${rustCount} Rust)`,
  `Packages without their own local license/notice file: ${withoutLocalFiles}`,
  `Of those, remaining metadata-only entries: ${missing.length}`,
  ...(missing.length ? ['', 'Metadata-only entries requiring a source-license lookup:', ...missing.map(value => `  ${value}`)] : []),
  '',
  'Package Index',
  '-------------',
  ...records.map(record => `${record.ecosystem} | ${record.name} ${record.version} | ${record.license}`),
];

for (const record of records) {
  sections.push('', '='.repeat(78), `${record.ecosystem}: ${record.name} ${record.version}`, `License: ${record.license}`, `Included as: ${record.purpose}`);
  if (record.repository) sections.push(`Upstream: ${record.repository}`);
  if (record.distribution) sections.push(`Package: ${record.distribution}`);
  if (record.archive) sections.push(`Source archive: ${record.archive}`);
  if (record.sharedFrom) sections.push(`Shared upstream license files: ${record.sharedFrom} (same declared repository and license)`);
  if (!record.files.length) sections.push('', 'No standalone license or notice file was present in the installed package.', 'See the license declaration and upstream source archive above.');
  for (const file of record.files) sections.push('', `--- ${file.filename} ---`, '', file.contents);
}

await writeFile(output, `${sections.join('\n')}\n`, 'utf8');
const licenseCounts = {};
for (const record of records) licenseCounts[record.license] = (licenseCounts[record.license] ?? 0) + 1;
process.stdout.write(`${JSON.stringify({ output: path.relative(root, output), packages: records.length, npm: npmCount, rust: rustCount, licenseFiles: records.reduce((sum, record) => sum + record.files.length, 0), metadataOnly: missing, licenses: licenseCounts }, null, 2)}\n`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packageLinux } from '../package-portable.mjs';

const script = fileURLToPath(new URL('../package-portable.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df01-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri/target/release'), { recursive: true });
  await writeFile(path.join(root, 'src-tauri/target/release/df01-studio.exe'), 'test executable');
  await writeFile(path.join(root, 'README.md'), 'Mzee <xiemaths@outlook.com> · 上海玖驱科技有限公司');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.1' }));
  const config = { version: '1.1.1', bundle: { resources: { '../README.md': 'README.md' } } };
  const configure = () => writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify(config));
  await configure();
  const run = () => spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', root], { encoding: 'utf8', windowsHide: true });
  return { root, config, configure, run };
}
const windows = { skip: process.platform !== 'win32' };

test('Windows portable needs no installer and replaces the ZIP with verified resources and matching checksum', windows, async t => {
  const { root, run } = await fixture(t);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Verified 2 entries/);
  const release = path.join(root, 'release');
  assert.deepEqual((await readdir(release)).sort(), ['DF-01-1.1.1-portable.zip', 'SHA256SUMS.txt']);
  const archive = path.join(release, 'DF-01-1.1.1-portable.zip');
  const original = await readFile(archive);
  await writeFile(path.join(root, 'README.md'), 'Updated author documentation');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const updated = await readFile(archive);
  assert.notDeepEqual(original, updated);
  const hash = createHash('sha256').update(updated).digest('hex').toUpperCase();
  assert.equal((await readFile(path.join(release, 'SHA256SUMS.txt'), 'utf8')).trim(), `${hash}  DF-01-1.1.1-portable.zip`);
});

for (const [name, mutate, message] of [
  ['version mismatch', c => { c.version = '1.1.0'; }, /versions differ/],
  ['resource outside project', c => { c.bundle.resources = { '../../outside.md': 'README.md' }; }, /escapes project/],
  ['archive traversal', c => { c.bundle.resources = { '../README.md': '../README.md' }; }, /Unsafe archive destination/],
  ['duplicate executable', c => { c.bundle.resources = { '../README.md': 'DF01-STUDIO.EXE' }; }, /Duplicate archive destination/],
  ['missing resource', c => { c.bundle.resources = { '../missing.md': 'missing.md' }; }, /Missing build artifact or resource/],
]) {
  test(`Windows rejects ${name} without replacing an existing release`, windows, async t => {
    const { root, config, configure, run } = await fixture(t);
    const release = path.join(root, 'release');
    await mkdir(release);
    const archive = path.join(release, 'DF-01-1.1.1-portable.zip');
    await writeFile(archive, 'previous release');
    mutate(config);
    await configure();
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(await readFile(archive, 'utf8'), 'previous release');
  });
}

test('Linux rejects unsupported architectures before accessing artifacts', async () => {
  await assert.rejects(packageLinux('.', 'unknown'), /Unsupported Linux architecture/);
});

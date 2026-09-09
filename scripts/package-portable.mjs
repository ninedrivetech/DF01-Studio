import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './platform.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));

function within(root, name) {
  const result = path.resolve(root, name);
  const relative = path.relative(root, result);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes package root: ${name}`);
  }
  return result;
}

export async function packageLinux(root, arch = process.arch) {
  const architectures = { x64: ['amd64', 'x86_64'], arm64: ['arm64', 'aarch64'] };
  const aliases = architectures[arch];
  if (!aliases) throw new Error(`Unsupported Linux architecture: ${arch}`);
  root = await realpath(root);
  const { version } = await json(path.join(root, 'package.json'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric release version.');
  const config = await json(path.join(root, 'src-tauri', 'tauri.conf.json'));
  const bundle = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
  const artifact = async (folder, extension) => {
    const directory = path.join(bundle, folder);
    const names = await readdir(directory).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing ${folder} build. Run npm run bundle on Linux first.`);
    });
    const matches = names.filter(name => name.includes(`_${version}_`) && aliases.some(alias => name.endsWith(`_${alias}.${extension}`)));
    if (matches.length !== 1) throw new Error(`Expected one ${extension} for ${version}/${arch} in ${directory}; found ${matches.length}.`);
    const filename = path.join(directory, matches[0]);
    if (!(await lstat(filename)).isFile()) throw new Error(`Build artifact must be a regular file: ${filename}`);
    return filename;
  };
  const appImage = await artifact('appimage', 'AppImage');
  const deb = await artifact('deb', 'deb');
  const resources = [];
  for (const [source, destination] of Object.entries(config.bundle.resources)) {
    const filename = await realpath(within(root, path.join('src-tauri', source)));
    within(root, path.relative(root, filename));
    if (!(await stat(filename)).isFile()) throw new Error(`Resource must be a file: ${source}`);
    resources.push({ filename, destination });
  }
  const release = path.join(root, 'release');
  await mkdir(release, { recursive: true });
  if ((await lstat(release)).isSymbolicLink()) throw new Error('Release directory must not be a link.');
  const temporary = await mkdtemp(path.join(release, '.linux-package-'));
  try {
    const staging = path.join(temporary, 'portable');
    await mkdir(staging);
    const executable = path.join(staging, 'df01-studio.AppImage');
    await copyFile(appImage, executable);
    await chmod(executable, 0o755);
    const destinations = new Set(['df01-studio.AppImage']);
    for (const { filename, destination } of resources) {
      const target = within(staging, destination);
      if (destinations.has(path.relative(staging, target))) throw new Error(`Duplicate package resource: ${destination}`);
      destinations.add(path.relative(staging, target));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(filename, target);
    }
    const prefix = `DF-01-${version}-linux-${arch}`;
    const archiveName = `${prefix}-portable.tar.gz`;
    const debName = `${prefix}.deb`;
    const checksumName = `SHA256SUMS-linux-${arch}.txt`;
    run('tar', ['-czf', path.join(temporary, archiveName), '-C', staging, '.']);
    await copyFile(deb, path.join(temporary, debName));
    const checksums = [];
    for (const name of [debName, archiveName]) {
      const hash = createHash('sha256').update(await readFile(path.join(temporary, name))).digest('hex').toUpperCase();
      checksums.push(`${hash}  ${name}`);
    }
    await writeFile(path.join(temporary, checksumName), `${checksums.join('\n')}\n`);
    for (const name of [debName, archiveName, checksumName]) await rename(path.join(temporary, name), path.join(release, name));
    return { release, files: [debName, archiveName, checksumName] };
  } finally {
    // Only remove the unique directory created by this invocation.
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function main() {
  if (process.argv.length > 2) throw new Error('package:portable accepts no arguments; use a native default-target release build.');
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'scripts', 'package-portable.ps1')], { cwd: projectRoot });
  } else if (process.platform === 'linux') {
    if (process.env.CARGO_TARGET_DIR || process.env.CARGO_BUILD_TARGET) throw new Error('package:portable expects src-tauri/target/release. Unset custom Cargo target settings and build natively.');
    console.log(JSON.stringify(await packageLinux(projectRoot), null, 2));
  } else {
    throw new Error(`Portable packaging supports Windows and Linux; current platform: ${process.platform}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
  return result;
}

export function rustTarget(explicit, env = process.env) {
  if (explicit) return explicit;
  if (env.CARGO_BUILD_TARGET) return env.CARGO_BUILD_TARGET;
  const result = run('rustc', ['-vV'], { encoding: 'utf8', stdio: 'pipe' });
  const host = /^host:\s*(\S+)/m.exec(result.stdout)?.[1];
  if (!host) throw new Error('Cannot determine the Rust host target from rustc -vV.');
  return host;
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function patchBuildScript(source, { memoryMiB = 512, threads = 8 } = {}) {
  if (!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > 1024) throw new Error('WASM_INITIAL_MEMORY_MIB must be an integer from 256 to 1024.');
  if (!Number.isInteger(threads) || threads < 4 || threads > 16) throw new Error('WASM_PTHREAD_POOL_SIZE must be an integer from 4 to 16.');
  const original = '-sPTHREAD_POOL_SIZE=22 -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -s INITIAL_MEMORY=2013265920';
  if (source.split(original).length !== 2) throw new Error('Pinned engine build flags have changed; review before applying the memory profile.');
  return source.replace(original, '-sPTHREAD_POOL_SIZE=' + threads + ' -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -sINITIAL_MEMORY=' + (memoryMiB * 1024 * 1024) + ' -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sDYNAMIC_EXECUTION=0');
}

export function prepareWasm(root = project, env = process.env) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'upstream.sources.json'), 'utf8'));
  const source = path.join(root, 'vendor/wasm');
  const expected = manifest.sources.wasm.commit;
  if (!/^[a-f0-9]{40}$/.test(expected || '')) throw new Error('Resolve and review the source lock first.');
  const current = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (current !== expected) throw new Error('WASM checkout differs from the source lock.');
  const memoryMiB = Number(env.WASM_INITIAL_MEMORY_MIB || 512);
  const threads = Number(env.WASM_PTHREAD_POOL_SIZE || 8);
  const patched = patchBuildScript(fs.readFileSync(path.join(source, 'build_luanti.sh'), 'utf8'), { memoryMiB, threads });
  const profile = { wrapperCommit: expected, memoryMiB, threads, patchHash: createHash('sha256').update(patched).digest('hex') };
  const profileId = createHash('sha256').update(JSON.stringify(profile)).digest('hex').slice(0, 16);
  const buildSource = path.join(root, 'runtime', 'wasm-' + profileId);
  const stamp = path.join(buildSource, 'miners-build-profile.json');
  if (fs.existsSync(stamp)) {
    if (fs.readFileSync(stamp, 'utf8') !== JSON.stringify(profile, null, 2) + '\n') throw new Error('Build profile differs from its recorded configuration.');
    if (createHash('sha256').update(fs.readFileSync(path.join(buildSource, 'build_luanti.sh'))).digest('hex') !== profile.patchHash) throw new Error('Prepared build script has been changed after preparation.');
    return buildSource;
  }
  if (fs.existsSync(buildSource)) throw new Error('Incomplete build source already exists. Review/archive it before retrying.');
  fs.cpSync(source, buildSource, { recursive: true, filter(file) {
    const parts = path.relative(source, file).split(path.sep);
    return !parts.includes('.git') && !['emsdk', 'www'].includes(parts[0]) && !/^build(?:-|$)/.test(parts[0]);
  } });
  fs.writeFileSync(path.join(buildSource, 'build_luanti.sh'), patched);
  fs.writeFileSync(stamp, JSON.stringify(profile, null, 2) + '\n');
  return buildSource;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareWasm());

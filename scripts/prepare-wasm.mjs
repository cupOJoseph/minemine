import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function patchDependencyScripts(libarchive, libzip) {
  function replaceOnce(source, from, to) {
    if (source.split(from).length !== 2) throw new Error('Pinned dependency build script has changed; review before patching.');
    return source.replace(from, to);
  }
  return {
    'build_libarchive.sh': replaceOnce(libarchive, 'emconfigure ./configure \\\n', 'emconfigure ./configure --host=wasm32-unknown-none \\\n'),
    'build_libzip.sh': replaceOnce(libzip, 'emcmake cmake \\\n', 'emcmake cmake -DBUILD_SHARED_LIBS=OFF -DBUILD_TOOLS=OFF -DBUILD_REGRESS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_DOC=OFF \\\n'),
  };
}
export function patchBuildScript(source, { memoryMiB = 512, threads = 8 } = {}) {
  if (!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > 1024) throw new Error('WASM_INITIAL_MEMORY_MIB must be an integer from 256 to 1024.');
  if (!Number.isInteger(threads) || threads < 4 || threads > 16) throw new Error('WASM_PTHREAD_POOL_SIZE must be an integer from 4 to 16.');
  const original = '-sPTHREAD_POOL_SIZE=22 -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -s INITIAL_MEMORY=2013265920';
  if (source.split(original).length !== 2) throw new Error('Pinned engine build flags have changed; review before applying the memory profile.');
  return source.replace(original, '-sPTHREAD_POOL_SIZE=' + threads + ' -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -sINITIAL_MEMORY=' + (memoryMiB * 1024 * 1024) + ' -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sDYNAMIC_EXECUTION=0');
}
export function patchBuildAll(source) {
  const original = './fetch_sources.sh\n\n# Dependencies';
  if (source.split(original).length !== 2) throw new Error('Pinned build order changed; review before patching browser source.');
  return source.replace(original, './fetch_sources.sh\nnode miners-patch-args.mjs sources/luanti/src/mainloop.cpp\n\n# Dependencies');
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
  const dependencies = patchDependencyScripts(fs.readFileSync(path.join(source, 'build_libarchive.sh'), 'utf8'), fs.readFileSync(path.join(source, 'build_libzip.sh'), 'utf8'));
  const scripts = {
    'build_luanti.sh': patched,
    'build_all.sh': patchBuildAll(fs.readFileSync(path.join(source, 'build_all.sh'), 'utf8')),
    'miners-patch-args.mjs': fs.readFileSync(path.join(root, 'scripts/patch-wasm-args.mjs'), 'utf8'),
    ...dependencies,
  };
  const scriptHashes = Object.fromEntries(Object.entries(scripts).map(([name, text]) => [name, createHash('sha256').update(text).digest('hex')]));
  const profile = { schema: 3, wrapperCommit: expected, memoryMiB, threads, patchHash: scriptHashes['build_luanti.sh'], scriptHashes };
  // The source patch changes the compiled binary, so it gets a distinct build profile.
  const profileId = createHash('sha256').update(JSON.stringify({ schema: 3, wrapperCommit: expected, memoryMiB, threads, scriptHashes })).digest('hex').slice(0, 16);
  const buildSource = path.join(root, 'runtime', 'wasm-' + profileId);
  const stamp = path.join(buildSource, 'miners-build-profile.json');
  if (fs.existsSync(stamp)) {
    if (fs.readFileSync(stamp, 'utf8') !== JSON.stringify(profile, null, 2) + '\n') throw new Error('Build profile differs from its recorded configuration.');
    for (const [name, expectedHash] of Object.entries(scriptHashes)) {
      if (createHash('sha256').update(fs.readFileSync(path.join(buildSource, name))).digest('hex') !== expectedHash) throw new Error('Prepared build script has been changed after preparation: ' + name);
    }
    return buildSource;
  }
  if (fs.existsSync(buildSource)) throw new Error('Incomplete build source already exists. Review/archive it before retrying.');
  fs.cpSync(source, buildSource, { recursive: true, filter(file) {
    const parts = path.relative(source, file).split(path.sep);
    return !parts.includes('.git') && !['emsdk', 'www'].includes(parts[0]) && !/^build(?:-|$)/.test(parts[0]);
  } });
  for (const [name, text] of Object.entries(scripts)) fs.writeFileSync(path.join(buildSource, name), text);
  fs.writeFileSync(stamp, JSON.stringify(profile, null, 2) + '\n');
  return buildSource;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareWasm());

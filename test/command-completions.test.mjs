import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const compiler = spawnSync('c++', ['--version'], { encoding: 'utf8' });
test('native command hints and Tab complete only concrete text', {skip: !!compiler.error}, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minemine-command-'));
  try {
    const source = path.join(work, 'probe.cpp'), binary = path.join(work, 'probe');
    fs.writeFileSync(source, `
#include "minemine-command-hints.h"
#include <cassert>
using minemine::commandHint;
int main() {
    auto part = commandHint(L"/structure_p");
    assert(part.known && part.ghost == L"review <style> <seed> [count] [compact]" && part.completion == L"review ");
    assert(commandHint(L"/structure_preview des").completion == L"ert ");
    auto seed = commandHint(L"/structure_preview desert ");
    assert(seed.ghost == L"<seed> [count] [compact]" && seed.completion.empty());
    assert(commandHint(L"/structure_preview  desert  42 6 c").completion == L"ompact");
    assert(commandHint(L"/d").completion == L"ay");
    assert(commandHint(L"/day").known && commandHint(L"/day").completion.empty());
    assert(!commandHint(L"hello").known && !commandHint(L"/invalid").known);
    assert(commandHint(L"/structure_return").ghost.empty());
    assert(commandHint(L"/structure_preview desert 42 6 compact extra").ghost.empty());
}
`);
    const headers = fileURLToPath(new URL('../scripts/', import.meta.url));
    const result = spawnSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-I', headers, source, '-o', binary], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const run = spawnSync(binary, [], {encoding:'utf8'});
    assert.equal(run.status, 0, run.stderr);
  } finally {
    fs.rmSync(work, {recursive:true, force:true});
  }
});

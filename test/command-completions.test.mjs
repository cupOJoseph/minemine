import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCommand } from '../playtest/command-completions.mjs';

test('command hints show required and optional arguments without inserting placeholders', () => {
  const partial = suggestCommand('/structure_p');
  assert.equal(partial.ghost, 'review <style> <seed> [count] [compact]');
  assert.equal(partial.value, '/structure_preview ');
  const seed = suggestCommand('/structure_preview desert ');
  assert.equal(seed.ghost, '<seed> [count] [compact]');
  assert.equal(seed.value, null);
});

test('village style and compact flag are actual completion choices', () => {
  assert.equal(suggestCommand('/structure_preview des').value, '/structure_preview desert ');
  assert.equal(suggestCommand('/structure_preview desert 42 6 c').value, '/structure_preview desert 42 6 compact');
  const first = suggestCommand('/structure_preview ');
  const next = suggestCommand('/structure_preview ', 1);
  assert.notEqual(first.value, next.value);
});

test('exact commands take priority and ordinary chat stays ordinary', () => {
  assert.equal(suggestCommand('/d').value, '/day');
  assert.equal(suggestCommand('/day').ghost, '');
  assert.equal(suggestCommand('/not-a-command'), null);
  assert.equal(suggestCommand('hi everyone'), null);
});

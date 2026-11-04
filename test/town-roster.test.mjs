import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { townMembership } from '../server/town-roster.mjs';

const owner = `w_${'a'.repeat(17)}`;
const member = `w_${'b'.repeat(17)}`;
const outsider = `w_${'c'.repeat(17)}`;

test('private town roster reports owner, member and no membership without exposing the member list', t => {
  const world = mkdtempSync(path.join(tmpdir(), 'minemine-town-roster-'));
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(path.join(world, 'town-admin-roster.json'), JSON.stringify({ version: 1, towns: [{
    name: 'Probe Town', owner, members: [member], claims: 2, protectedColumns: 18,
  }] }));
  assert.equal(townMembership(world, owner).town.role, 'owner');
  const belonging = townMembership(world, member);
  assert.deepEqual(belonging.town, {
    name: 'Probe Town', role: 'member', owner, memberCount: 1, claimCount: 2, protectedColumns: 18,
  });
  assert.equal(JSON.stringify(belonging).includes(`"members"`), false);
  assert.deepEqual(townMembership(world, outsider).town, null);
  assert.equal(townMembership(world, outsider).status, 'none');
});

test('malformed or conflicting roster fails closed', t => {
  const world = mkdtempSync(path.join(tmpdir(), 'minemine-town-roster-'));
  t.after(() => rmSync(world, { recursive: true, force: true }));
  const file = path.join(world, 'town-admin-roster.json');
  assert.equal(townMembership(world, owner).status, 'unavailable');
  writeFileSync(file, JSON.stringify({ version: 1, towns: [
    { name: 'One Town', owner, members: [member], claims: 0, protectedColumns: 0 },
    { name: 'Two Town', owner: outsider, members: [member], claims: 0, protectedColumns: 0 },
  ] }));
  assert.equal(townMembership(world, member).status, 'unavailable');
  writeFileSync(file, '{broken');
  assert.equal(townMembership(world, member).status, 'unavailable');
});

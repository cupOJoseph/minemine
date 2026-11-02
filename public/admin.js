const status = document.getElementById('status');
const refreshButton = document.getElementById('refresh');
const online = document.getElementById('online-players');
const playerRows = document.getElementById('player-rows');
const playerQuery = document.getElementById('player-query');
const playerPageLabel = document.getElementById('player-page-label');
const playerPrev = document.getElementById('player-prev');
const playerNext = document.getElementById('player-next');
const playerDetail = document.getElementById('player-detail');
const playerDetailStatus = document.getElementById('player-detail-status');
const profileBetaAction = document.getElementById('profile-beta-action');
const nameOperations = document.getElementById('name-operations');
const nameForm = document.getElementById('name-reservation');
const nameHandle = document.getElementById('name-handle');
const nameIntendedAddress = document.getElementById('name-intended-address');
const nameStatus = document.getElementById('name-status');
const nameReservations = document.getElementById('name-reservations');
const betaOperations = document.getElementById('beta-operations');
const betaCreate = document.getElementById('beta-create');
const betaCreateStatus = document.getElementById('beta-create-status');
const betaSecret = document.getElementById('beta-secret');
const betaList = document.getElementById('beta-codes');
const auditOperations = document.getElementById('audit-operations');
const auditRows = document.getElementById('audit-rows');
const auditStatus = document.getElementById('audit-status');
let playerPage = 1;
let playerRequest = 0;
let playerDetailRequest = 0;
const number = (id, value) => { document.getElementById(id).textContent = String(value); };
const label = (id, value) => { document.getElementById(id).textContent = value; };
const dateLabel = value => new Date(value).toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
function clear() {
  playerRequest++;
  playerDetailRequest++;
  profileBetaAction.hidden = true;
  playerDetail.hidden = true;
  for (const id of ['current-count', 'daily-count', 'weekly-count', 'monthly-count']) number(id, '—');
  online.replaceChildren();
  const item = document.createElement('li');
  item.className = 'empty';
  item.textContent = 'Sign in to view native world activity.';
  online.appendChild(item);
  playerRows.replaceChildren();
  const row = playerRows.insertRow();
  row.insertCell().colSpan = 6;
  row.cells[0].textContent = 'Sign in to view recent characters.';
  playerPageLabel.textContent = '—';
  playerPrev.disabled = true;
  playerNext.disabled = true;
  nameOperations.hidden = true;
  nameReservations.replaceChildren();
  betaOperations.hidden = true;
  betaSecret.hidden = true;
  betaSecret.textContent = '';
  betaList.replaceChildren();
  auditOperations.hidden = true;
  auditRows.replaceChildren();
  auditStatus.textContent = '';
}

async function inspectPlayer(name) {
  const request = ++playerDetailRequest;
  playerDetail.hidden = false;
  playerDetailStatus.textContent = 'Checking current ENS ownership…';
  profileBetaAction.hidden = true;
  for (const id of ['profile-character', 'profile-wallet', 'profile-ens', 'profile-town', 'profile-first', 'profile-last']) label(id, '—');
  try {
    const response = await fetch(`/api/admin/players/${encodeURIComponent(name)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('Could not load this character profile.');
    const profile = await response.json();
    if (request !== playerDetailRequest) return;
    label('profile-character', profile.playerName);
    label('profile-wallet', profile.address);
    label('profile-ens', profile.ensName || 'No currently verified ENS name');
    const membership = profile.townMembership;
    if (membership?.status === 'present' && membership.town) {
      const town = membership.town;
      label('profile-town', `${town.role === 'owner' ? 'Owner' : 'Member'} of ${town.name} · owner ${town.owner} · ${town.memberCount} members · ${town.claimCount} claims · ${town.protectedColumns} protected columns · snapshot ${dateLabel(membership.snapshotAt)}`);
    } else if (membership?.status === 'none') {
      label('profile-town', `No town membership · snapshot ${dateLabel(membership.snapshotAt)}`);
    } else label('profile-town', 'Native town roster unavailable');
    label('profile-first', dateLabel(profile.firstSignedInAt));
    label('profile-last', dateLabel(profile.lastSignedInAt));
    const admission = profile.betaAdmission;
    label('profile-beta', admission ? `${admission.revokedAt ? `Suspended ${dateLabel(admission.revokedAt)}` : `Admitted ${dateLabel(admission.admittedAt)}`}${profile.betaGateEnabled ? '' : ' · invite gate off'}` : 'No redeemed invite');
    if (admission) {
      profileBetaAction.hidden = false;
      profileBetaAction.textContent = admission.revokedAt ? 'Restore beta access' : 'Suspend beta access';
      profileBetaAction.onclick = async () => {
        profileBetaAction.disabled = true;
        playerDetailStatus.textContent = 'Updating beta access…';
        try {
          await betaPost(`/api/admin/beta/admissions/${admission.revokedAt ? 'restore' : 'revoke'}`, { address: profile.address });
          await inspectPlayer(name);
          await refreshAudit();
        } catch (error) { playerDetailStatus.textContent = error.message; }
        finally { profileBetaAction.disabled = false; }
      };
    }
    playerDetailStatus.textContent = 'Signed wallet profile loaded.';
  } catch (error) {
    if (request === playerDetailRequest) playerDetailStatus.textContent = error.message;
  }
}

async function refreshAudit() {
  const response = await fetch('/api/admin/audit', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Could not load recent activity.');
  const { events } = await response.json();
  auditRows.replaceChildren();
  for (const event of events) {
    const row = auditRows.insertRow();
    for (const value of [dateLabel(event.at), `${event.source}: ${event.target}`, event.action.replaceAll('_', ' '), event.actor]) row.insertCell().textContent = value;
  }
  if (!events.length) {
    const row = auditRows.insertRow();
    row.insertCell().colSpan = 4;
    row.cells[0].textContent = 'No username or invite activity yet.';
  }
  auditStatus.textContent = '';
}

async function betaPost(route, payload) {
  const response = await fetch(route, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not change beta access.');
  return result;
}

async function refreshBetaCodes() {
  const response = await fetch('/api/admin/beta/codes', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Could not load beta codes.');
  const { codes } = await response.json();
  betaList.replaceChildren();
  if (!codes.length) {
    const item = document.createElement('li');
    item.textContent = 'No beta codes created.';
    betaList.appendChild(item);
  }
  for (const code of codes) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${code.id.slice(0, 8)} · ${code.uses}/${code.maxUses} used · expires ${dateLabel(code.expiresAt)}${code.intendedAccount ? ' · ' + code.intendedAccount : ''}${code.revokedAt ? ' · revoked' : ''}`;
    item.appendChild(label);
    if (!code.revokedAt) {
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.textContent = 'Revoke';
      revoke.setAttribute('aria-label', `Revoke beta code ${code.id.slice(0, 8)}`);
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          await betaPost('/api/admin/beta/codes/revoke', { id: code.id });
          betaCreateStatus.textContent = `Revoked code ${code.id.slice(0, 8)}.`;
          await refreshBetaCodes();
          await refreshAudit();
        } catch (error) { betaCreateStatus.textContent = error.message; revoke.disabled = false; }
      });
      item.appendChild(revoke);
    }
    betaList.appendChild(item);
  }
}

async function nameRequest(route, handle, intendedAddress) {
  const response = await fetch(route, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, ...(intendedAddress ? { intendedAddress } : {}) }), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not change the reservation.');
  return result;
}

async function refreshReservations() {
  const response = await fetch('/api/admin/names', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Could not load username reservations.');
  const { reservations } = await response.json();
  nameReservations.replaceChildren();
  if (!reservations.length) {
    const item = document.createElement('li');
    item.textContent = 'No active administrative holds.';
    nameReservations.appendChild(item);
  }
  for (const reservation of reservations) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${reservation.handle}.minemine.eth · ${reservation.intendedAccount ? `for ${reservation.intendedAccount} · ` : ''}until ${dateLabel(reservation.expiresAt)}`;
    const release = document.createElement('button');
    release.type = 'button';
    release.textContent = 'Release';
    release.setAttribute('aria-label', `Release ${reservation.handle}`);
    release.addEventListener('click', async () => {
      release.disabled = true;
      try {
        await nameRequest('/api/admin/names/release', reservation.handle);
        nameStatus.textContent = `Released ${reservation.handle}.`;
        await refreshReservations();
        await refreshAudit();
      } catch (error) { nameStatus.textContent = error.message; release.disabled = false; }
    });
    item.append(label, release);
    nameReservations.appendChild(item);
  }
}

async function refreshPlayers() {
  const request = ++playerRequest;
  playerDetailRequest++;
  playerDetail.hidden = true;
  const params = new URLSearchParams({ q: playerQuery.value.trim().toLowerCase(), page: String(playerPage) });
  const response = await fetch(`/api/admin/players?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clear();
    throw new Error(response.status === 400 ? 'Enter a character ID, full wallet address, MineMine username or full ENS name.' : 'Player explorer is temporarily unavailable.');
  }
  const data = await response.json();
  if (request !== playerRequest) return;
  playerRows.replaceChildren();
  for (const player of data.players) {
    const row = playerRows.insertRow();
    for (const value of [player.playerName, player.walletAddress || 'Earlier join',
      dateLabel(player.firstSeen), dateLabel(player.lastSeen), String(player.joins)]) row.insertCell().textContent = value;
    const inspect = document.createElement('button');
    inspect.className = 'inspect-button';
    inspect.type = 'button';
    inspect.textContent = 'Inspect';
    inspect.disabled = !player.walletAddress;
    inspect.setAttribute('aria-label', `Inspect ${player.playerName}`);
    inspect.addEventListener('click', () => inspectPlayer(player.playerName));
    row.insertCell().append(inspect);
  }
  if (!data.players.length) {
    const row = playerRows.insertRow();
    row.insertCell().colSpan = 6;
    row.cells[0].textContent = 'No matching joins in the last 12 months.';
  }
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  playerPageLabel.textContent = `Page ${data.page} of ${lastPage} · ${data.total} characters`;
  playerPrev.disabled = data.page <= 1;
  playerNext.disabled = data.page >= lastPage;
}

async function refresh(withPlayers = true) {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Refreshing native world statistics…';
  try {
    const response = await fetch('/api/admin/stats', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.status === 401) { clear(); throw new Error('Sign in with your admin wallet on the MineMine home page, then return here.'); }
    if (response.status === 403) { clear(); throw new Error('This wallet is not authorized for MineMine admin statistics.'); }
    if (!response.ok) throw new Error('Statistics are temporarily unavailable. Try again shortly.');
    const stats = await response.json();
    number('current-count', stats.current.count);
    number('daily-count', stats.active.daily);
    number('weekly-count', stats.active.weekly);
    number('monthly-count', stats.active.monthly);
    label('current-label', stats.current.fresh ? 'Native world presence is live' : 'Presence unavailable or stale');
    label('daily-label', `Since ${dateLabel(stats.periods.dayStart)}`);
    label('weekly-label', `Since ${dateLabel(stats.periods.weekStart)}`);
    label('monthly-label', `Since ${dateLabel(stats.periods.monthStart)}`);
    label('updated', `Checked ${dateLabel(new Date().toISOString())}`);
    online.replaceChildren();
    for (const name of stats.current.playerNames) {
      const item = document.createElement('li');
      item.textContent = name;
      online.appendChild(item);
    }
    if (!stats.current.playerNames.length) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = stats.current.fresh ? 'No players are connected.' : 'Current presence is unavailable.';
      online.appendChild(item);
    }
    status.textContent = stats.current.fresh ? 'Statistics are up to date.' : 'Historical joins are available; current presence is stale or the server is offline.';
    nameOperations.hidden = false;
    betaOperations.hidden = false;
    auditOperations.hidden = false;
    if (withPlayers) {
      await refreshPlayers();
      await refreshReservations().catch(error => { nameStatus.textContent = error.message; });
      await refreshBetaCodes().catch(error => { betaCreateStatus.textContent = error.message; });
      await refreshAudit().catch(error => { auditStatus.textContent = error.message; });
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', () => refresh());
document.getElementById('player-detail-close').addEventListener('click', () => {
  playerDetailRequest++;
  playerDetail.hidden = true;
});
document.getElementById('player-search').addEventListener('submit', event => { event.preventDefault(); playerPage = 1; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
nameForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = nameForm.querySelector('button');
  button.disabled = true;
  nameStatus.textContent = 'Reserving username…';
  try {
    const result = await nameRequest('/api/admin/names/reserve', nameHandle.value, nameIntendedAddress.value.trim());
    nameStatus.textContent = `Reserved ${result.handle}.minemine.eth${result.intendedAccount ? ` for ${result.intendedAccount}` : ''} until ${dateLabel(result.expiresAt)}.`;
    nameForm.reset();
    await refreshReservations();
    await refreshAudit();
  } catch (error) { nameStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
betaCreate.addEventListener('submit', async event => {
  event.preventDefault();
  const button = betaCreate.querySelector('button');
  button.disabled = true;
  betaCreateStatus.textContent = 'Creating invite…';
  betaSecret.hidden = true;
  betaSecret.textContent = '';
  try {
    const result = await betaPost('/api/admin/beta/codes/create', {
      maxUses: Number(document.getElementById('beta-max-uses').value),
      days: Number(document.getElementById('beta-days').value),
      intendedAccount: document.getElementById('beta-intended').value.trim() || null,
    });
    betaSecret.textContent = result.code;
    betaSecret.hidden = false;
    betaCreateStatus.textContent = `Code created. Expires ${dateLabel(result.expiresAt)}. Copy it now; it will not appear in the list.`;
    await refreshBetaCodes();
    await refreshAudit();
  } catch (error) { betaCreateStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
playerPrev.addEventListener('click', () => { if (playerPage > 1) playerPage--; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
playerNext.addEventListener('click', () => { playerPage++; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 15_000);
refresh();

const status = document.getElementById('status');
const refreshButton = document.getElementById('refresh');
const online = document.getElementById('online-players');
const playerRows = document.getElementById('player-rows');
const playerQuery = document.getElementById('player-query');
const playerPageLabel = document.getElementById('player-page-label');
const playerPrev = document.getElementById('player-prev');
const playerNext = document.getElementById('player-next');
let playerPage = 1;
let playerRequest = 0;
const number = (id, value) => { document.getElementById(id).textContent = String(value); };
const label = (id, value) => { document.getElementById(id).textContent = value; };
const dateLabel = value => new Date(value).toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
function clear() {
  playerRequest++;
  for (const id of ['current-count', 'daily-count', 'weekly-count', 'monthly-count']) number(id, '—');
  online.replaceChildren();
  const item = document.createElement('li');
  item.className = 'empty';
  item.textContent = 'Sign in to view native world activity.';
  online.appendChild(item);
  playerRows.replaceChildren();
  const row = playerRows.insertRow();
  row.insertCell().colSpan = 4;
  row.cells[0].textContent = 'Sign in to view recent characters.';
  playerPageLabel.textContent = '—';
  playerPrev.disabled = true;
  playerNext.disabled = true;
}

async function refreshPlayers() {
  const request = ++playerRequest;
  const params = new URLSearchParams({ q: playerQuery.value.trim().toLowerCase(), page: String(playerPage) });
  const response = await fetch(`/api/admin/players?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clear();
    throw new Error(response.status === 400 ? 'Search using lowercase letters, numbers or underscores.' : 'Player explorer is temporarily unavailable.');
  }
  const data = await response.json();
  if (request !== playerRequest) return;
  playerRows.replaceChildren();
  for (const player of data.players) {
    const row = playerRows.insertRow();
    for (const value of [player.playerName, dateLabel(player.firstSeen), dateLabel(player.lastSeen), String(player.joins)]) row.insertCell().textContent = value;
  }
  if (!data.players.length) {
    const row = playerRows.insertRow();
    row.insertCell().colSpan = 4;
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
    if (withPlayers) await refreshPlayers();
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', () => refresh());
document.getElementById('player-search').addEventListener('submit', event => { event.preventDefault(); playerPage = 1; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
playerPrev.addEventListener('click', () => { if (playerPage > 1) playerPage--; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
playerNext.addEventListener('click', () => { playerPage++; refreshPlayers().catch(error => { status.classList.add('error'); status.textContent = error.message; }); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 15_000);
refresh();

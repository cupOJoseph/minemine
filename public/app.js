const $ = (id) => document.getElementById(id);
let config, session, busy = false;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function api(route, data) {
  const response = await fetch(`/api/${route}`, { credentials: 'same-origin', ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function renderSession() {
  $('identity').hidden = !session;
  $('logout').hidden = !session;
  $('connect').hidden = !!session;
  $('connect').disabled = busy || !config;
  $('play').disabled = busy || !session || !config?.gameReady;
  $('refresh-balance').disabled = busy || !session || !config?.tokenAddress;
  if (session) { $('player').textContent = session.playerName; $('address').textContent = session.address; }
}
async function refreshBalance() {
  const data = await api('currency/balance');
  $('balance').replaceChildren(document.createTextNode(data.configured ? data.formatted : '—'), Object.assign(document.createElement('span'), { textContent: 'MINE' }));
  $('currency-status').textContent = data.configured ? `Observed at block ${data.blockNumber}.` : 'Token contract and RPC are not configured.';
}
async function signOut() {
  await api('auth/logout', {});
  session = null;
  $('engine-container').replaceChildren();
  $('engine-container').hidden = true;
  $('balance').textContent = '—';
  status('Signed out. Connect your wallet to sign in again.');
  renderSession();
}
$('connect').addEventListener('click', async () => {
  busy = true; renderSession();
  try {
    if (!window.ethereum?.request) throw new Error('Install or enable an Ethereum browser wallet, then reload this page.');
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const requestedChain = `0x${config.chainId.toString(16)}`;
    let chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (Number(chain) !== config.chainId) {
      status('Approve the test-network switch in your wallet.');
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: requestedChain }] });
      chain = await window.ethereum.request({ method: 'eth_chainId' });
    }
    const challenge = await api('auth/challenge', { address, chainId: Number(chain) });
    status('Review and sign the login message in your wallet. No transaction is requested.');
    const messageHex = `0x${Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('')}`;
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [messageHex, address] });
    const activeAccounts = await window.ethereum.request({ method: 'eth_accounts' });
    const activeChain = await window.ethereum.request({ method: 'eth_chainId' });
    if (activeAccounts[0]?.toLowerCase() !== address.toLowerCase() || Number(activeChain) !== config.chainId) throw new Error('Wallet account or network changed during sign-in. Please try again.');
    session = await api('auth/verify', { signature });
    status(config.gameReady ? 'Signed in. Your world is ready.' : 'Signed in. The shared world is awaiting the engine build and server deployment.');
    if (config.tokenAddress) await refreshBalance();
  } catch (error) { status(error.code === 4001 ? 'Wallet request cancelled. You can try again.' : error.message, true); }
  finally { busy = false; renderSession(); }
});
$('logout').addEventListener('click', () => signOut().catch(e => status(e.message, true)));
$('refresh-balance').addEventListener('click', () => refreshBalance().catch(e => status(e.message, true)));
$('play').addEventListener('click', async () => {
  busy = true; renderSession();
  try {
    if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('The engine needs cross-origin isolation and SharedArrayBuffer. Check your hosting headers.');
    const { launch } = await import('/engine/adapter.js');
    const ticket = await api('game/ticket', {});
    $('engine-container').hidden = false;
    // The audited, same-origin adapter receives the capability in memory only.
    // Never place it in a URL, localStorage, logs, or third-party page.
    await launch({ container: $('engine-container'), ticket });
    ticket.password = '';
    status('Game launched.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; renderSession(); }
});
window.ethereum?.on?.('accountsChanged', () => { if (!busy && session) signOut().catch(e => status(e.message, true)); });
window.ethereum?.on?.('chainChanged', () => { if (!busy && session) signOut().catch(e => status(e.message, true)); });
try {
  config = await api('config');
  $('network').textContent = config.chainId === 11155111 ? 'SEPOLIA TESTNET' : 'LOCAL TESTNET';
  $('engine-status').textContent = config.gameReady ? 'ENGINE READY' : config.enginePresent ? 'ADAPTER PENDING' : 'ENGINE PENDING';
  if (config.tokenAddress) $('currency-status').textContent = 'Sign in to read your token balance.';
  try { session = await api('session'); } catch { /* Signed out is expected. */ }
  if (session) { status('Wallet session restored.'); if (config.tokenAddress) await refreshBalance(); }
} catch (error) { status(`Unable to reach the launcher service: ${error.message}`, true); }
renderSession();

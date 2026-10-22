import { encodeAllowance, encodeApprove, encodeBuyBlocks, encodeTransfer, parseTokenAmount } from './transfer.mjs';

const $ = id => document.getElementById(id);
let config, session, busy = false, tokenDecimals, townPriceRaw;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function transferStatus(message, error = false) { $('transfer-status').textContent = message; $('transfer-status').classList.toggle('error', error); }
function townStatus(message, error = false) { $('town-status').textContent = message; $('town-status').classList.toggle('error', error); }
function formatToken(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
async function api(route, data) {
  const response = await fetch('/api/' + route, { credentials: 'same-origin', ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
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
  $('send-form').hidden = !session || !config?.tokenAddress;
  $('send').disabled = busy || tokenDecimals === undefined;
  $('town-form').hidden = !session || !config?.townContractAddress;
  $('buy-town-blocks').disabled = busy || townPriceRaw === undefined || tokenDecimals === undefined;
  $('sync-town-blocks').disabled = busy || !session || !config?.townContractAddress;
  if (session) {
    $('player').textContent = session.ensName || session.playerName;
    $('address').textContent = session.address;
  }
}
async function refreshIdentity() {
  if (!session) return;
  try { session = await api('identity'); } catch { /* Address remains authoritative if ENS is unavailable. */ }
  renderSession();
}
async function refreshBalance() {
  const data = await api('currency/balance');
  tokenDecimals = data.configured ? data.decimals : undefined;
  $('balance').replaceChildren(document.createTextNode(data.configured ? data.formatted : '—'), Object.assign(document.createElement('span'), { textContent: 'MINE' }));
  $('currency-status').textContent = data.configured ? 'Observed at block ' + data.blockNumber + ' on chain ' + data.chainId + '.' : 'Token contract and RPC are not configured.';
  renderSession();
}
async function refreshTownStatus() {
  if (!config?.townContractAddress || !session) return;
  const value = await api('towns/status');
  townPriceRaw = value.configured ? BigInt(value.pricePerBlockRaw) : undefined;
  $('town-balance').replaceChildren(document.createTextNode(String(value.purchasedBlocks ?? '—') + ' '), Object.assign(document.createElement('span'), { textContent: 'land columns purchased' }));
  $('town-price').textContent = value.configured && tokenDecimals !== undefined ? formatToken(townPriceRaw, tokenDecimals) + ' MINE per column · ' + value.confirmationDepth + ' confirmation blocks' : 'Town payment contract not deployed.';
  renderSession();
}
async function waitForTransaction(hash) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (receipt) {
      if (Number(receipt.status) !== 1) throw new Error('Transaction failed on chain: ' + hash);
      return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Transaction is still pending: ' + hash + '. Check your wallet and retry sync after it confirms.');
}
function setPlayLinks(href) {
  for (const id of ['nav-play', 'hero-play', 'feature-play', 'footer-play']) $(id).href = href;
}
async function signOut() {
  await api('auth/logout', {});
  session = null;
  tokenDecimals = undefined;
  townPriceRaw = undefined;
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
    const requestedChain = '0x' + config.chainId.toString(16);
    let chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (Number(chain) !== config.chainId) {
      status('Approve the test-network switch in your wallet.');
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: requestedChain }] });
      chain = await window.ethereum.request({ method: 'eth_chainId' });
    }
    const challenge = await api('auth/challenge', { address, chainId: Number(chain) });
    status('Review and sign the login message in your wallet. No transaction is requested.');
    const messageHex = '0x' + Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('');
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [messageHex, address] });
    const activeAccounts = await window.ethereum.request({ method: 'eth_accounts' });
    const activeChain = await window.ethereum.request({ method: 'eth_chainId' });
    if (activeAccounts[0]?.toLowerCase() !== address.toLowerCase() || Number(activeChain) !== config.chainId) throw new Error('Wallet account or network changed during sign-in. Please try again.');
    session = await api('auth/verify', { signature });
    status(config.gameReady ? 'Signed in. Your world is ready.' : 'Signed in. Shared multiplayer is still being built.');
    await refreshIdentity();
    if (config.tokenAddress) await refreshBalance();
    if (config.townContractAddress) await refreshTownStatus().catch(error => townStatus(error.message, true));
  } catch (error) { status(error.code === 4001 ? 'Wallet request cancelled. You can try again.' : error.message, true); }
  finally { busy = false; renderSession(); }
});
$('logout').addEventListener('click', () => signOut().catch(error => status(error.message, true)));
$('refresh-balance').addEventListener('click', () => refreshBalance().catch(error => status(error.message, true)));
$('send-form').addEventListener('submit', async event => {
  event.preventDefault();
  busy = true; renderSession();
  try {
    if (!window.ethereum?.request || !session || !config?.tokenAddress) throw new Error('Connect your wallet and configure MINE first.');
    if (tokenDecimals === undefined) throw new Error('Refresh your balance before sending.');
    const [account] = await window.ethereum.request({ method: 'eth_accounts' });
    const chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (account?.toLowerCase() !== session.address.toLowerCase() || Number(chain) !== config.chainId) throw new Error('Wallet account or network changed. Sign in again.');
    const input = $('recipient').value.trim();
    const recipient = await api('currency/recipient?input=' + encodeURIComponent(input));
    const amount = parseTokenAmount($('amount').value.trim(), tokenDecimals);
    if (recipient.address.toLowerCase() === session.address.toLowerCase()) throw new Error('Enter another player’s address.');
    const label = recipient.ensName ? recipient.ensName + ' (' + recipient.address + ')' : recipient.address;
    if (!window.confirm('Send ' + $('amount').value.trim() + ' MINE to ' + label + ' on chain ' + config.chainId + '? Your wallet will request a token transaction and network gas.')) {
      transferStatus('Transfer cancelled.');
      return;
    }
    transferStatus('Approve the token transfer in your wallet.');
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: session.address, to: config.tokenAddress, data: encodeTransfer(recipient.address, amount) }] });
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Wallet returned an invalid transaction hash.');
    transferStatus('Transaction submitted: ' + hash + '. Check your wallet for confirmation, then refresh your balance.');
    $('amount').value = '';
  } catch (error) { transferStatus(error.code === 4001 ? 'Wallet transaction cancelled.' : error.message, true); }
  finally { busy = false; renderSession(); }
});
$('sync-town-blocks').addEventListener('click', async () => {
  busy = true; renderSession();
  try {
    const value = await api('towns/sync', {});
    townStatus('Synced ' + value.purchasedBlocks + ' confirmed land columns at block ' + value.blockNumber + '.');
    await refreshTownStatus();
  } catch (error) { townStatus(error.message, true); }
  finally { busy = false; renderSession(); }
});
$('town-form').addEventListener('submit', async event => {
  event.preventDefault();
  busy = true; renderSession();
  try {
    if (!window.ethereum?.request || !session || !config?.townContractAddress || townPriceRaw === undefined || tokenDecimals === undefined) throw new Error('Connect your wallet and configure town payments first.');
    const count = Number($('town-blocks').value);
    const purchaseData = encodeBuyBlocks(count);
    const cost = BigInt(count) * townPriceRaw;
    const [account] = await window.ethereum.request({ method: 'eth_accounts' });
    const chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (account?.toLowerCase() !== session.address.toLowerCase() || Number(chain) !== config.chainId) throw new Error('Wallet account or network changed. Sign in again.');
    if (!window.confirm('Buy ' + count + ' protected land columns for ' + formatToken(cost, tokenDecimals) + ' MINE on chain ' + config.chainId + '? This uses wallet transactions and network gas.')) {
      townStatus('Purchase cancelled.');
      return;
    }
    const allowanceData = encodeAllowance(session.address, config.townContractAddress);
    const currentAllowance = BigInt(await window.ethereum.request({ method: 'eth_call', params: [{ to: config.tokenAddress, data: allowanceData }, 'latest'] }));
    if (currentAllowance < cost) {
      townStatus('Approve the exact MINE amount in your wallet.');
      const approval = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: session.address, to: config.tokenAddress, data: encodeApprove(config.townContractAddress, cost) }] });
      await waitForTransaction(approval);
    }
    townStatus('Approve the land purchase in your wallet.');
    const purchase = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: session.address, to: config.townContractAddress, data: purchaseData }] });
    await waitForTransaction(purchase);
    townStatus('Purchase mined: ' + purchase + '. Wait for the configured confirmations, then sync land credits.');
  } catch (error) { townStatus(error.code === 4001 ? 'Wallet request cancelled.' : error.message, true); }
  finally { busy = false; renderSession(); }
});
$('play').addEventListener('click', async () => {
  busy = true; renderSession();
  try {
    if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('The engine needs cross-origin isolation and SharedArrayBuffer. Check your hosting headers.');
    const { launch } = await import('/engine/adapter.js');
    const ticket = await api('game/ticket', {});
    $('engine-container').hidden = false;
    await launch({ container: $('engine-container'), ticket });
    ticket.password = '';
    status('Game launched.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; renderSession(); }
});
window.ethereum?.on?.('accountsChanged', () => { if (!busy && session) signOut().catch(error => status(error.message, true)); });
window.ethereum?.on?.('chainChanged', () => { if (!busy && session) signOut().catch(error => status(error.message, true)); });
try {
  config = await api('config');
  setPlayLinks(config.soloPlaytestAvailable ? '/engine/index.html' : 'https://cupojoseph.github.io/minemine/play/');
  $('engine-status').textContent = config.gameReady ? 'SHARED WORLD READY' : 'SHARED WORLD PENDING';
  if (config.tokenAddress) $('currency-status').textContent = 'Sign in to read your testnet balance.';
  try { session = await api('session'); } catch { /* Signed out is expected. */ }
  if (session) {
    status('Wallet session restored.');
    await refreshIdentity();
    if (config.tokenAddress) await refreshBalance();
    if (config.townContractAddress) await refreshTownStatus().catch(error => townStatus(error.message, true));
  }
} catch {
  // GitHub Pages serves this landing page without the Node wallet service.
  status('The wallet lab needs the MineMine server. The solo playtest is ready from Play now.');
  $('engine-status').textContent = 'SERVER OFFLINE';
}
renderSession();

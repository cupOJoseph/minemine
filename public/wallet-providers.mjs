// EIP-6963 discovers wallets without relying on extension injection order.
export function createWalletRegistry(browser, onChange = () => {}) {
  const entries = [];
  const add = (provider, name) => {
    if (!provider || typeof provider.request !== 'function' || entries.some(entry => entry.provider === provider) || entries.length >= 16) return;
    entries.push({ provider, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Ethereum wallet' });
    onChange(entries.slice());
  };
  browser.addEventListener('eip6963:announceProvider', event => {
    const detail = event.detail;
    if (detail?.info && detail.provider) add(detail.provider, detail.info.name);
  });
  browser.dispatchEvent(new Event('eip6963:requestProvider'));
  const refreshLegacy = () => add(browser.ethereum, 'Browser wallet');
  refreshLegacy();
  return { list: () => entries.slice(), refreshLegacy };
}

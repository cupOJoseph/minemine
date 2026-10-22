// ERC-20 transfer(address,uint256), encoded without a browser bundle.
export function parseTokenAmount(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals.');
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  const [whole, fractional = ''] = value.split('.');
  if (fractional.length > decimals) throw new Error(`MINE supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fractional.padEnd(decimals, '0') || '0'));
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Amount is out of range.');
  return amount;
}

export function encodeTransfer(address, amount) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid recipient address.');
  if (typeof amount !== 'bigint' || amount <= 0n || amount >= 2n ** 256n) throw new Error('Invalid transfer amount.');
  return '0xa9059cbb' + address.slice(2).toLowerCase().padStart(64, '0') + amount.toString(16).padStart(64, '0');
}

export function encodeApprove(spender, amount) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) throw new Error('Invalid town contract address.');
  if (typeof amount !== 'bigint' || amount <= 0n || amount >= 2n ** 256n) throw new Error('Invalid approval amount.');
  return '0x095ea7b3' + spender.slice(2).toLowerCase().padStart(64, '0') + amount.toString(16).padStart(64, '0');
}

export function encodeAllowance(owner, spender) {
  if (![owner, spender].every(value => /^0x[0-9a-fA-F]{40}$/.test(value))) throw new Error('Invalid allowance address.');
  return '0xdd62ed3e' + owner.slice(2).toLowerCase().padStart(64, '0') + spender.slice(2).toLowerCase().padStart(64, '0');
}

export function encodeBuyBlocks(count) {
  if (!Number.isInteger(count) || count < 1 || count > 4096) throw new Error('Choose 1 to 4096 land blocks.');
  return '0xc17dbdf9' + BigInt(count).toString(16).padStart(64, '0');
}

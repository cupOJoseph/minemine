const target = document.getElementById('account-root');
try {
  const response = await fetch('/api/config', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Account configuration is unavailable.');
  const settings = await response.json();
  if (!settings.zeroDevTestProjectId) {
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    message.textContent = 'Email account testing is not configured on this host. The wallet-only playtest remains available.';
    target.replaceChildren(message);
  } else {
    const { start } = await import('/account/account.js');
    start(settings);
  }
} catch (error) {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.className = 'account-error';
  message.textContent = error.message;
  target.replaceChildren(message);
}

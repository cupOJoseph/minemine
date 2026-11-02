// Public static assets only. Keep the worker's scope inside /minemine/.
// Source: gzuidhof/coi-serviceworker@7b1d2a092d0d2dd2b7270b6f12f13605de26f214
window.coi = {
  coepCredentialless: () => false,
  coepDegrade: () => false,
  quiet: true,
};

// On a first Pages visit the worker can become active after coi-serviceworker's
// registration callback checks for control. Reload once after activation so the
// navigation receives the worker's COOP/COEP headers.
if (window.crossOriginIsolated) {
  sessionStorage.removeItem('minemineCoiRecoveryReload');
} else if (window.isSecureContext && navigator.serviceWorker) {
  let reloading = false;
  const reloadOnce = () => {
    if (reloading || sessionStorage.getItem('minemineCoiRecoveryReload')) return;
    reloading = true;
    sessionStorage.setItem('minemineCoiRecoveryReload', '1');
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.crossOriginIsolated) reloadOnce();
  });
  navigator.serviceWorker.ready.then(() => {
    setTimeout(() => {
      if (!window.crossOriginIsolated) reloadOnce();
    }, 1000);
  });
}

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSendOTP, useVerifyOTP, zeroDevWallet } from '@zerodev/wallet-react';
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { sepolia } from 'wagmi/chains';

const root = createRoot(document.getElementById('account-root'));
const chainRpc = 'https://ethereum-sepolia-rpc.publicnode.com';

async function api(route, data) {
  const response = await fetch(`/api/${route}`, {
    credentials: 'same-origin',
    ...(data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function AccountLab({ nameCheckoutTestEnabled }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [handle, setHandle] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP();

  useEffect(() => {
    if (!isConnected || !address) { setSession(null); setCheckoutUrl(''); return; }
    let current = true;
    setSession(null); setCheckoutUrl('');
    api('session').then(value => {
      if (current) setSession(value.address?.toLowerCase() === address.toLowerCase() ? value : null);
    }).catch(() => { if (current) setSession(null); });
    return () => { current = false; };
  }, [address, isConnected]);

  async function sendCode(event) {
    event.preventDefault(); setError(''); setStatus('Sending a one-time code…');
    try {
      const result = await sendOTP.mutateAsync({ email: email.trim() });
      setOtp({ id: result.otpId, bundle: result.otpEncryptionTargetBundle });
      setStatus('Code sent. Enter it below to create or reopen your test wallet.');
    } catch (cause) { setError(cause.message); setStatus(''); }
  }

  async function verifyCode(event) {
    event.preventDefault(); setError(''); setStatus('Verifying your code…');
    try {
      await verifyOTP.mutateAsync({ otpId: otp.id, otpEncryptionTargetBundle: otp.bundle, code: code.trim() });
      setCode(''); setStatus('Wallet connected. Sign the MineMine message to open a test session.');
    } catch (cause) { setError(cause.message); setStatus(''); }
  }

  async function signIn() {
    setError(''); setStatus('Preparing your MineMine sign-in message…');
    try {
      if (!address || chainId !== sepolia.id) throw new Error('Connect the Sepolia test wallet first.');
      const challenge = await api('auth/challenge', { address, chainId });
      setStatus('Review and sign the MineMine message. Signing does not spend funds.');
      const signature = await signMessageAsync({ message: challenge.message });
      const verified = await api('auth/verify', { signature });
      if (verified.address?.toLowerCase() !== address.toLowerCase()) throw new Error('Wallet address changed during sign-in.');
      setSession(verified); setStatus('Test wallet signed in to MineMine.');
    } catch (cause) { setError(cause.message); setStatus(''); }
  }

  async function signOut() {
    setError('');
    try {
      await api('auth/logout', {});
      await disconnectAsync();
      setSession(null); setOtp(null); setEmail(''); setCode(''); setHandle(''); setCheckoutUrl('');
      setStatus('Signed out of MineMine and ZeroDev.');
    } catch (cause) { setError(cause.message); }
  }

  async function prepareCheckout(event) {
    event.preventDefault(); setError(''); setCheckoutUrl(''); setCheckoutPending(true);
    try {
      if (!session || !address || session.address?.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Sign in with your ZeroDev test wallet again.');
      }
      const result = await api('names/checkout', { handle: handle.trim() });
      const target = new URL(result.url);
      if (!result.testMode || target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') {
        throw new Error('The test checkout link is invalid.');
      }
      setCheckoutUrl(target.href);
      setStatus(`Test checkout prepared for ${result.handle}.minemine.eth. Continue on Stripe to use a test card.`);
    } catch (cause) { setError(cause.message); setStatus(''); }
    finally { setCheckoutPending(false); }
  }

  const returnState = new URLSearchParams(window.location.search).get('name_checkout');

  return <div className="account-form">
    {isConnected ? <>
      <p>ZeroDev test wallet: <strong className="account-address">{address}</strong></p>
      {session ? <>
        <p>MineMine test session: <strong>{session.playerName}</strong></p>
        {nameCheckoutTestEnabled ? <form className="account-form account-checkout" onSubmit={prepareCheckout}>
          <h2>Choose a MineMine username</h2>
          <label htmlFor="account-handle">Username</label>
          <input id="account-handle" type="text" autoComplete="off" pattern="[A-Za-z][A-Za-z0-9]{2,15}" maxLength={16}
            value={handle} onChange={event => { setHandle(event.target.value); setCheckoutUrl(''); }} required />
          <p className="account-note">Your public name would be <strong>{handle.trim().toLowerCase() || 'username'}.minemine.eth</strong>. MineMine manages the ENS record; the name is not a transferable token. The planned single $2 USD charge covers the account and its first year, starting after verified ENS activation. Renewal is required after that year.</p>
          <p className="account-note">This lab uses Stripe test mode. It does not charge a real card or issue an ENS name.</p>
          <button className="button button-primary" type="submit" disabled={checkoutPending || !handle.trim()}>Prepare $2 test checkout</button>
          {checkoutUrl && <a className="button button-ghost account-checkout-link" href={checkoutUrl}>Continue to Stripe test checkout</a>}
        </form> : <p className="account-note">Username checkout and shared-world access are not enabled in this lab.</p>}
      </> : <button className="button button-primary" type="button" disabled={signing} onClick={signIn}>Sign in to MineMine</button>}
      <button className="button button-ghost" type="button" onClick={signOut}>Sign out</button>
    </> : otp ? <form className="account-form" onSubmit={verifyCode}>
      <label htmlFor="account-code">Code sent to {email}</label>
      <input id="account-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required />
      <button className="button button-primary" type="submit" disabled={verifyOTP.isPending || !code.trim()}>Verify code</button>
      <button className="button button-ghost" type="button" onClick={() => { setOtp(null); setCode(''); }}>Use a different email</button>
    </form> : <form className="account-form" onSubmit={sendCode}>
      <label htmlFor="account-email">Email address</label>
      <input id="account-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
      <button className="button button-primary" type="submit" disabled={sendOTP.isPending || !email.trim()}>Send one-time code</button>
    </form>}
    {status && <p role="status">{status}</p>}
    {returnState === 'success' && <p role="status">Returned from Stripe test checkout. The server verifies payment by webhook; ENS activation is still pending.</p>}
    {returnState === 'cancelled' && <p role="status">Test checkout was cancelled. The temporary username hold remains until Stripe confirms expiry.</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
  </div>;
}

export function start(settings) {
  const wagmi = createConfig({
    chains: [sepolia],
    connectors: [zeroDevWallet({ projectId: settings.zeroDevTestProjectId, chains: [sepolia], mode: '7702' })],
    transports: { [sepolia.id]: http(chainRpc) },
  });
  root.render(<WagmiProvider config={wagmi}><QueryClientProvider client={new QueryClient()}><AccountLab nameCheckoutTestEnabled={settings.nameCheckoutTestEnabled} /></QueryClientProvider></WagmiProvider>);
}

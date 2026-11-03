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

function AccountLab() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { address, chainId, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP();

  useEffect(() => {
    if (!isConnected || !address) { setSession(null); return; }
    let current = true;
    api('session').then(value => {
      if (current && value.address?.toLowerCase() === address.toLowerCase()) setSession(value);
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
      setSession(null); setOtp(null); setEmail(''); setCode('');
      setStatus('Signed out of MineMine and ZeroDev.');
    } catch (cause) { setError(cause.message); }
  }

  return <div className="account-form">
    {isConnected ? <>
      <p>ZeroDev test wallet: <strong className="account-address">{address}</strong></p>
      {session ? <>
        <p>MineMine test session: <strong>{session.playerName}</strong></p>
        <p className="account-note">The $2 checkout, username reservation, and shared-world access are not enabled in this lab.</p>
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
    {error && <p role="alert" className="account-error">{error}</p>}
  </div>;
}

export function start(settings) {
  const wagmi = createConfig({
    chains: [sepolia],
    connectors: [zeroDevWallet({ projectId: settings.zeroDevTestProjectId, chains: [sepolia], mode: '7702' })],
    transports: { [sepolia.id]: http(chainRpc) },
  });
  root.render(<WagmiProvider config={wagmi}><QueryClientProvider client={new QueryClient()}><AccountLab /></QueryClientProvider></WagmiProvider>);
}

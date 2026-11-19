"use client";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

export const chain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "local",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"] } },
});

export const publicClient = createPublicClient({ chain, transport: http() });

// Demo wallets. On testnet the app holds these keys for the user so there is no
// seed phrase or wallet popup (swap for Circle passkey wallets if time allows).
export function walletFor(key: Hex) {
  const account = privateKeyToAccount(key);
  return createWalletClient({ chain, transport: http(), account });
}

/** Mom's payment. The server holds her demo key and signs for her. */
export async function ownerPay(to: Address, amount: string) {
  const r = await fetch(`${SERVER}/app/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, amount }),
  });
  return (await r.json()) as { ok: boolean; instant?: boolean; error?: string; hash?: string };
}

/** The real guardian's tap. The server holds the guardian's demo key and signs the EIP-712 decision. */
export async function guardianDecide(id: string, approve: boolean) {
  const r = await fetch(`${SERVER}/app/guardian-decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, approve }),
  });
  return (await r.json()) as { ok: boolean; error?: string; hash?: string; execHash?: string };
}

export const DECISION_TYPES = {
  Decision: [
    { name: "vault", type: "address" },
    { name: "actionId", type: "uint256" },
    { name: "approve", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Sign a guardian decision with `key` and ask the server to relay it. */
export async function signAndRelay(key: Hex, vault: Address, id: string, approve: boolean) {
  const account = privateKeyToAccount(key);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await account.signTypedData({
    domain: { name: "GuardianVault", version: "1", chainId: chain.id, verifyingContract: vault },
    types: DECISION_TYPES,
    primaryType: "Decision",
    message: { vault, actionId: BigInt(id), approve, deadline },
  });
  const r = await fetch(`${SERVER}/relay/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault, id, approve, deadline: deadline.toString(), signature }),
  });
  return (await r.json()) as { ok: boolean; error?: string; hash?: string; execHash?: string };
}

/** A key that is not the guardian's: what a voice-clone scammer would have at best. */
export const impostorKey = () => generatePrivateKey();

// Move funds from old vaults to new ones and trust the demo grandson.
// Usage: OLD_FAMILY=0x.. OLD_HONEYPOT=0x.. NEW_FAMILY=0x.. NEW_HONEYPOT=0x.. node scripts/migrate.js
import "dotenv/config";
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, getAddress, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = process.env;
const abi = JSON.parse(fs.readFileSync(new URL("../abi.json", import.meta.url)));
const chain = defineChain({ id: Number(env.CHAIN_ID), name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [env.RPC_URL] } } });
const pub = createPublicClient({ chain, transport: http() });
const client = (k) => createWalletClient({ chain, transport: http(), account: privateKeyToAccount(k) });
const owner = client(env.DEMO_OWNER_KEY), guardian = client(env.DEMO_GUARDIAN_KEY), relayer = client(env.RELAYER_KEY);

async function send(w, address, functionName, args) {
  const hash = await w.writeContract({ address, abi, functionName, args });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${functionName} reverted ${hash}`);
  return rcpt;
}
const queuedId = (rcpt) => parseEventLogs({ abi, logs: rcpt.logs, eventName: "ActionQueued" })[0].args.id;

// guardian signs, relayer submits (the guardian holds no gas)
async function approve(guardianW, vault, id) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await guardianW.account.signTypedData({
    domain: { name: "GuardianVault", version: "1", chainId: chain.id, verifyingContract: vault },
    types: { Decision: [{ name: "vault", type: "address" }, { name: "actionId", type: "uint256" }, { name: "approve", type: "bool" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Decision", message: { vault, actionId: id, approve: true, deadline },
  });
  await send(relayer, vault, "decideBySig", [id, true, deadline, signature]);
}

// owner pays (held), guardian approves, anyone executes
async function move(from, to, ownerW, guardianW, label) {
  const bal = await pub.readContract({ address: from, abi, functionName: "balance" });
  if (bal === 0n) return console.log(`${label}: empty`);
  const id = env[`${label.toUpperCase()}_PENDING`] ? BigInt(env[`${label.toUpperCase()}_PENDING`]) : queuedId(await send(ownerW, from, "pay", [to, bal]));
  await approve(guardianW, from, id);
  const r = await send(relayer, from, "execute", [id]);
  console.log(`${label}: moved ${Number(bal) / 1e6} USDC  tx ${r.transactionHash}`);
}

const [OF, OH, NF, NH] = [env.OLD_FAMILY, env.OLD_HONEYPOT, env.NEW_FAMILY, env.NEW_HONEYPOT].map((a) => a.toLowerCase());
await move(OF, NF, owner, guardian, "family");
await move(OH, NH, relayer, relayer, "honeypot");
const id = queuedId(await send(owner, NF, "requestTrust", [env.DEMO_TRUSTED.toLowerCase()]));
await approve(guardian, NF, id);
await send(relayer, NF, "execute", [id]);
console.log("grandson trusted on new family vault");

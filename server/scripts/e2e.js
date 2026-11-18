// End-to-end check against a running chain + server (local anvil by default).
// node scripts/e2e.js
import "dotenv/config";
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const abi = JSON.parse(fs.readFileSync(new URL("../abi.json", import.meta.url)));
const SERVER = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const chain = defineChain({
  id: Number(process.env.CHAIN_ID ?? 31337),
  name: "x",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "http://127.0.0.1:8545"] } },
});
const OWNER_KEY = process.env.E2E_OWNER_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const GUARDIAN_KEY = process.env.E2E_GUARDIAN_KEY ?? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const GRANDSON = process.env.E2E_TRUSTED ?? "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const vault = getAddress(process.env.FAMILY_VAULT);

const pub = createPublicClient({ chain, transport: http() });
const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(OWNER_KEY) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

async function pay(to, usd) {
  const { request, result } = await pub.simulateContract({
    account: owner.account, address: vault, abi, functionName: "pay", args: [to, parseUnits(String(usd), 6)],
  });
  await pub.waitForTransactionReceipt({ hash: await owner.writeContract(request) });
  return result;
}

async function sign(key, id, approve) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: { name: "GuardianVault", version: "1", chainId: chain.id, verifyingContract: vault },
    types: { Decision: [
      { name: "vault", type: "address" }, { name: "actionId", type: "uint256" },
      { name: "approve", type: "bool" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Decision",
    message: { vault, actionId: id, approve, deadline },
  });
  const r = await fetch(`${SERVER}/relay/decision`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault, id: id.toString(), approve, deadline: deadline.toString(), signature }),
  });
  return r.json();
}

const [instant] = await pay(GRANDSON, Number(process.env.DEMO_SMALL ?? 1));
check(instant, "small payment to trusted grandson is instant");

const scammer = privateKeyToAccount(generatePrivateKey()).address;
const [heldInstant, id] = await pay(scammer, Number(process.env.DEMO_BIG ?? 10));
check(!heldInstant, "large payment to a brand-new address is held");

let rec;
for (let i = 0; i < 20 && !rec?.risk; i++) {
  await sleep(1000);
  const state = await (await fetch(`${SERVER}/state`)).json();
  rec = state.actions.find((a) => a.vaultName === "family" && a.id === id.toString());
}
check(!!rec, "server picked up the held payment");
check(rec?.risk?.level === "high", `risk flagged high: ${rec?.risk?.reasons.join(", ")}`);

const fake = await sign(generatePrivateKey(), id, true);
check(!fake.ok, `impostor approval rejected (${fake.error?.slice(0, 60)})`);

const real = await sign(GUARDIAN_KEY, id, false);
check(real.ok, "guardian's signed cancel relayed");
const a = await pub.readContract({ address: vault, abi, functionName: "action", args: [id] });
check(a.status === 3, "action is Cancelled onchain");

const hp = await (await fetch(`${SERVER}/honeypot/attempt`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: scammer, amount: 5 }),
})).json();
check(hp.ok, "honeypot theft attempt held and cancelled");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

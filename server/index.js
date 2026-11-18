// Pause backend: watches vault events (local poller and/or QuickNode Streams webhook),
// scores held payments, pushes live updates to the app, relays guardian signatures,
// runs the public honeypot, and mints ElevenLabs signed URLs for the voice guardian.
import "dotenv/config";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  recoverTypedDataAddress,
  BaseError,
  ContractFunctionRevertedError,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const abi = JSON.parse(fs.readFileSync(new URL("./abi.json", import.meta.url)));
const env = process.env;

const chain = defineChain({
  id: Number(env.CHAIN_ID ?? 31337),
  name: env.CHAIN_NAME ?? "local",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL ?? "http://127.0.0.1:8545"] } },
});
const EXPLORER = env.EXPLORER_URL ?? ""; // e.g. https://testnet.arcscan.app

const pub = createPublicClient({ chain, transport: http() });
const relayer = privateKeyToAccount(env.RELAYER_KEY);
const wallet = createWalletClient({ chain, transport: http(), account: relayer });

const VAULTS = {
  family: getAddress(env.FAMILY_VAULT),
  honeypot: getAddress(env.HONEYPOT_VAULT),
};
const vaultName = (addr) =>
  Object.keys(VAULTS).find((k) => VAULTS[k].toLowerCase() === addr.toLowerCase());

const KIND = ["Transfer", "AddTrusted", "RaiseLimit", "SetGuardian"];
const STATUS = ["None", "Pending", "Executed", "Cancelled"];

// ---------------------------------------------------------------- state

const actions = new Map(); // `${vault}:${id}` -> record
const seenLogs = new Set();
const honeypot = { attempts: 0, blocked: 0, recent: [] };
const clients = new Set();

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const usd = (v) => Number(formatUnits(BigInt(v), 6));

// ------------------------------------------------------ terminal log bus
// Every interesting step is emitted as a structured line for the /console page.
// layer: app | chain | stream | risk | voice | relay | contract
const logLines = [];
let logSeq = 0;
function tlog(layer, msg, data) {
  const line = { seq: ++logSeq, t: Date.now(), layer, msg, data };
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
  broadcast("log", line);
  console.log(`[${layer}] ${msg}`);
}

function revertName(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r?.data?.errorName) return r.data.errorName;
  }
  return e.shortMessage ?? e.message;
}

const DECISION_TYPES = {
  Decision: [
    { name: "vault", type: "address" },
    { name: "actionId", type: "uint256" },
    { name: "approve", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
};
const domainFor = (vault) => ({ name: "GuardianVault", version: "1", chainId: chain.id, verifyingContract: vault });

async function riskFacts(vault, target, amount) {
  const [nonce, code, trusted, dailyLimit] = await Promise.all([
    pub.getTransactionCount({ address: target }),
    pub.getCode({ address: target }),
    pub.readContract({ address: vault, abi, functionName: "trusted", args: [target] }),
    pub.readContract({ address: vault, abi, functionName: "dailyLimit" }),
  ]);
  const reasons = [];
  if (!trusted) reasons.push("never paid before");
  if (nonce === 0 && !code) reasons.push("brand-new address with no history");
  if (dailyLimit > 0n && amount > dailyLimit)
    reasons.push(`${(Number(amount) / Number(dailyLimit)).toFixed(0)}x the daily limit`);
  const hour = new Date().getHours();
  if (hour < 7 || hour >= 22) reasons.push("unusual time of day");
  const level = reasons.length >= 3 ? "high" : reasons.length >= 1 ? "medium" : "low";
  return { level, reasons, recipientTxCount: nonce };
}

function summary(rec) {
  if (rec.kind === "Transfer")
    return `$${rec.amountUsd.toLocaleString()} to ${rec.target.slice(0, 6)}…${rec.target.slice(-4)}` +
      (rec.risk?.reasons.length ? ` (${rec.risk.reasons.join(", ")})` : "");
  if (rec.kind === "AddTrusted") return `Trust new recipient ${rec.target}`;
  if (rec.kind === "RaiseLimit") return `Raise daily limit to $${rec.amountUsd.toLocaleString()}`;
  return `Change guardian to ${rec.target}`;
}

async function handleLog(log, source) {
  const key = `${log.transactionHash}:${log.logIndex}`;
  if (seenLogs.has(key)) return;
  seenLogs.add(key);
  const name = vaultName(log.address);
  if (!name) return;

  let ev;
  try {
    ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
  } catch {
    return;
  }
  const vault = getAddress(log.address);
  const id = ev.args.id !== undefined ? ev.args.id.toString() : null;
  const k = `${vault}:${id}`;
  tlog(source === "quicknode" ? "stream" : "chain", `${ev.eventName} on ${name} vault`, {
    via: source === "quicknode" ? "QuickNode Stream webhook" : "RPC poller",
    block: log.blockNumber?.toString?.(),
    tx: log.transactionHash,
    args: Object.fromEntries(Object.entries(ev.args).map(([a, b]) => [a, typeof b === "bigint" ? b.toString() : b])),
  });

  if (ev.eventName === "ActionQueued") {
    const rec = {
      vault,
      vaultName: name,
      id,
      kind: KIND[ev.args.kind],
      target: ev.args.target,
      amount: ev.args.amount.toString(),
      amountUsd: ev.args.kind === 0 || ev.args.kind === 2 ? usd(ev.args.amount) : 0,
      readyAt: Number(ev.args.readyAt),
      status: "Pending",
      txHash: log.transactionHash,
      source,
    };
    if (rec.kind === "Transfer") {
      rec.risk = await riskFacts(vault, rec.target, ev.args.amount);
      tlog("risk", `scored held payment #${id}: ${rec.risk.level.toUpperCase()}`, {
        reasons: rec.risk.reasons,
        recipientTxCount: rec.risk.recipientTxCount,
      });
    }
    rec.summary = summary(rec);
    if (name === "family")
      tlog("voice", "guardian alerted: incoming call offered with ElevenLabs agent", {
        dynamicVariables: { amount: `$${rec.amountUsd}`, reasons: rec.risk?.reasons.join("; ") ?? rec.summary },
        note: "agent has no approve/cancel tool, voice cannot move money",
      });
    actions.set(k, rec);
    broadcast("action", rec);
    console.log(`[${source}] held #${id} on ${name}: ${rec.summary}`);
    if (name === "family") alertGuardian(rec);
    return;
  }

  const update = {
    ActionApproved: "Approved",
    ActionCancelled: "Cancelled",
    ActionExecuted: "Executed",
  }[ev.eventName];
  if (update && actions.has(k)) {
    const rec = actions.get(k);
    rec.status = update;
    rec[`${update.toLowerCase()}Tx`] = log.transactionHash;
    broadcast("action", rec);
  }
  if (ev.eventName === "InstantPayment") {
    broadcast("instant", {
      vaultName: name,
      to: ev.args.to,
      amountUsd: usd(ev.args.amount),
      txHash: log.transactionHash,
    });
  }
}

// Guardian alert hook. The app shows the alert and offers the voice briefing;
// an outbound phone call can be added here later (ElevenLabs + Twilio).
function alertGuardian(rec) {
  broadcast("alert", { key: `${rec.vault}:${rec.id}`, summary: rec.summary, risk: rec.risk });
}

// ---------------------------------------------------- local event watcher

if (env.LOCAL_WATCH !== "false") {
  for (const address of Object.values(VAULTS)) {
    pub.watchEvent({
      address,
      pollingInterval: 1000,
      onLogs: (logs) => logs.forEach((l) => handleLog(l, "poller")),
      onError: (e) => console.error("watch error", e.shortMessage ?? e.message),
    });
  }
}

// ------------------------------------------------------------------ http

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.get("/state", async (_req, res) => {
  const out = {};
  for (const [name, address] of Object.entries(VAULTS)) {
    const [balance, dailyLimit, remainingToday, delay, guardian, owner] = await Promise.all(
      ["balance", "dailyLimit", "remainingToday", "delay", "guardian", "owner"].map((fn) =>
        pub.readContract({ address, abi, functionName: fn })
      )
    );
    out[name] = {
      address,
      balanceUsd: usd(balance),
      dailyLimitUsd: usd(dailyLimit),
      remainingTodayUsd: usd(remainingToday),
      delaySeconds: Number(delay),
      guardian,
      owner,
    };
  }
  res.json({
    chainId: chain.id,
    explorer: EXPLORER,
    vaults: out,
    actions: [...actions.values()].sort((a, b) => b.readyAt - a.readyAt),
    honeypot,
  });
});

// QuickNode Streams destination. Accepts either raw log arrays or the
// filtered shape produced by quicknode/filter.js ({ logs: [...] }).
app.post("/webhook/quicknode", async (req, res) => {
  if (env.QUICKNODE_TOKEN && req.get("x-qn-token") !== env.QUICKNODE_TOKEN)
    return res.status(401).end();
  const body = req.body;
  const logs = Array.isArray(body) ? body.flat(2) : body.logs ?? body.data?.flat?.(2) ?? [];
  for (const l of logs) {
    if (!l?.topics) continue;
    await handleLog(
      { address: l.address, topics: l.topics, data: l.data, transactionHash: l.transactionHash, logIndex: l.logIndex },
      "quicknode"
    );
  }
  res.json({ ok: true, received: logs.length });
});

// Relay a guardian decision signed in the guardian's browser.
app.post("/relay/decision", async (req, res) => {
  const { vault, id, approve, deadline, signature } = req.body;
  try {
    await logSignature(getAddress(vault), id, approve, deadline, signature);
    const hash = await wallet.writeContract({
      address: getAddress(vault),
      abi,
      functionName: "decideBySig",
      args: [BigInt(id), Boolean(approve), BigInt(deadline), signature],
    });
    await pub.waitForTransactionReceipt({ hash });
    let execHash;
    if (approve) {
      execHash = await wallet.writeContract({ address: getAddress(vault), abi, functionName: "execute", args: [BigInt(id)] });
      await pub.waitForTransactionReceipt({ hash: execHash });
    }
    tlog("contract", `decideBySig accepted: action #${id} ${approve ? "approved + executed" : "cancelled"}`, { tx: hash, execTx: execHash });
    res.json({ ok: true, hash, execHash });
  } catch (e) {
    const why = revertName(e);
    tlog("contract", `decideBySig REVERTED: ${why}`, { action: id, approve });
    res.status(400).json({ ok: false, error: why });
  }
});

async function logSignature(vault, id, approve, deadline, signature) {
  const message = { vault, actionId: BigInt(id), approve: Boolean(approve), deadline: BigInt(deadline) };
  const signer = await recoverTypedDataAddress({
    domain: domainFor(vault), types: DECISION_TYPES, primaryType: "Decision", message, signature,
  });
  const guardian = await pub.readContract({ address: vault, abi, functionName: "guardian" });
  tlog("relay", `EIP-712 Decision received (${approve ? "approve" : "cancel"} #${id})`, {
    typedData: { vault, actionId: String(id), approve: Boolean(approve), deadline: String(deadline) },
    signature: `${signature.slice(0, 18)}…`,
    recoveredSigner: signer,
    vaultGuardian: guardian,
    match: signer.toLowerCase() === guardian.toLowerCase(),
  });
}

// ------------------------------------------------------ guided demo console
// Server-driven scenario so the /console page can step through every layer.
// Uses demo-only keys (DEMO_OWNER_KEY / DEMO_GUARDIAN_KEY): testnet or local only.
const demo = { scammer: null, heldId: null, guardianSwapId: null };

async function ownerPay(to, usdAmount) {
  const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(env.DEMO_OWNER_KEY) });
  const args = [to, parseUnits(String(usdAmount), 6)];
  tlog("app", `Mom taps Send: $${usdAmount} to ${to.slice(0, 10)}…`, { call: "GuardianVault.pay(to, amount)", args: [to, args[1].toString()] });
  const { request, result } = await pub.simulateContract({ account: owner.account, address: VAULTS.family, abi, functionName: "pay", args });
  const hash = await owner.writeContract(request);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  tlog("chain", `tx mined in block ${rcpt.blockNumber}`, { tx: hash, gasUsed: rcpt.gasUsed.toString(), gasToken: "USDC" });
  return { instant: result[0], id: result[1], hash };
}

async function signDecision(key, id, approve) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: domainFor(VAULTS.family), types: DECISION_TYPES, primaryType: "Decision",
    message: { vault: VAULTS.family, actionId: BigInt(id), approve, deadline },
  });
  return { deadline, signature };
}

async function relay(id, approve, deadline, signature) {
  try {
    await logSignature(VAULTS.family, id, approve, deadline, signature);
    const hash = await wallet.writeContract({
      address: VAULTS.family, abi, functionName: "decideBySig", args: [BigInt(id), approve, deadline, signature],
    });
    await pub.waitForTransactionReceipt({ hash });
    tlog("contract", `decideBySig accepted: action #${id} ${approve ? "approved" : "cancelled"}`, { tx: hash });
    return { ok: true, hash };
  } catch (e) {
    const why = revertName(e);
    tlog("contract", `decideBySig REVERTED: ${why}`, { action: String(id) });
    return { ok: false, error: why };
  }
}

const STEPS = {
  async trusted() {
    const grandson = getAddress(env.DEMO_TRUSTED);
    const r = await ownerPay(grandson, 20);
    tlog("contract", r.instant ? "trusted recipient + within daily limit -> sent instantly" : "unexpected: held", {});
    return r;
  },
  async scam() {
    demo.scammer = privateKeyToAccount(generatePrivateKey()).address;
    tlog("app", "Scam text: \"Your account is compromised. Move your savings to this safe address now.\"", {});
    const r = await ownerPay(demo.scammer, 2000);
    demo.heldId = r.id;
    tlog("contract", `not trusted / over limit -> HELD as action #${r.id}; funds stay in vault`, {});
    return r;
  },
  async deepfake() {
    if (demo.heldId === null) throw new Error("run the scam step first");
    tlog("voice", "Cloned voice on a call: \"Mom, it's me, just approve it.\"", { note: "scammer has a voice, not the guardian's key" });
    const { deadline, signature } = await signDecision(generatePrivateKey(), demo.heldId, true);
    return relay(demo.heldId, true, deadline, signature);
  },
  async cancel() {
    if (demo.heldId === null) throw new Error("run the scam step first");
    tlog("app", "Real guardian taps Stop on their phone; device signs the decision", {});
    const { deadline, signature } = await signDecision(env.DEMO_GUARDIAN_KEY, demo.heldId, false);
    const r = await relay(demo.heldId, false, deadline, signature);
    const bal = await pub.readContract({ address: VAULTS.family, abi, functionName: "balance" });
    tlog("chain", `vault balance still $${usd(bal).toLocaleString()}`, {});
    return r;
  },
  async swapGuardian() {
    const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(env.DEMO_OWNER_KEY) });
    tlog("app", "Scammer, on the phone with Mom, tells her to change her guardian to them", { call: "requestGuardian(scammer)" });
    const target = demo.scammer ?? privateKeyToAccount(generatePrivateKey()).address;
    const { request, result } = await pub.simulateContract({ account: owner.account, address: VAULTS.family, abi, functionName: "requestGuardian", args: [target] });
    const hash = await owner.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    demo.guardianSwapId = result;
    tlog("contract", `weakening protection is itself HELD as action #${result}`, { tx: hash });
    const { deadline, signature } = await signDecision(env.DEMO_GUARDIAN_KEY, result, false);
    return relay(result, false, deadline, signature);
  },
};

app.get("/logs", (_req, res) => res.json(logLines));

app.post("/demo/:step", async (req, res) => {
  const fn = STEPS[req.params.step];
  if (!fn) return res.status(404).json({ error: "unknown step" });
  if (!env.DEMO_OWNER_KEY || !env.DEMO_GUARDIAN_KEY) return res.status(503).json({ error: "demo keys not configured" });
  try {
    tlog("app", `--- step: ${req.params.step} ---`, {});
    const r = await fn();
    res.json({ ok: true, ...JSON.parse(JSON.stringify(r ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });
  } catch (e) {
    tlog("app", `step failed: ${revertName(e)}`, {});
    res.status(400).json({ ok: false, error: revertName(e) });
  }
});

// Keeper: execute any held action whose delay has passed.
app.post("/execute", async (req, res) => {
  try {
    const hash = await wallet.writeContract({
      address: getAddress(req.body.vault),
      abi,
      functionName: "execute",
      args: [BigInt(req.body.id)],
    });
    await pub.waitForTransactionReceipt({ hash });
    res.json({ ok: true, hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.shortMessage ?? e.message });
  }
});

// Public honeypot: anyone can "use the stolen key" to send funds anywhere.
// The server submits the payment as owner; it is held, and the guardian
// (also the server for this vault) cancels it.
app.post("/honeypot/attempt", async (req, res) => {
  try {
    const { to, amount } = req.body;
    if (!isAddress(to)) throw new Error("Enter a valid 0x address");
    const amt = parseUnits(String(Math.min(Math.max(Number(amount) || 1, 1), 1000)), 6);
    honeypot.attempts++;
    const { request, result } = await pub.simulateContract({
      account: relayer, address: VAULTS.honeypot, abi, functionName: "pay", args: [getAddress(to), amt],
    });
    const payHash = await wallet.writeContract(request);
    await pub.waitForTransactionReceipt({ hash: payHash });
    const [, id] = result;
    const cancelHash = await wallet.writeContract({ address: VAULTS.honeypot, abi, functionName: "cancel", args: [id] });
    await pub.waitForTransactionReceipt({ hash: cancelHash });
    honeypot.blocked++;
    const entry = { to, amountUsd: usd(amt), payHash, cancelHash, at: Date.now() };
    honeypot.recent = [entry, ...honeypot.recent].slice(0, 20);
    broadcast("honeypot", honeypot);
    res.json({ ok: true, ...entry });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.shortMessage ?? e.message });
  }
});

// ElevenLabs: signed URL so the browser can talk to the private voice agent.
app.get("/voice/signed-url", async (_req, res) => {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_AGENT_ID)
    return res.status(503).json({ error: "ElevenLabs not configured" });
  const r = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${env.ELEVENLABS_AGENT_ID}`,
    { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
  );
  if (!r.ok) return res.status(502).json({ error: `ElevenLabs ${r.status}` });
  const { signed_url } = await r.json();
  res.json({ signedUrl: signed_url });
});

const port = Number(env.PORT ?? 8787);
app.listen(port, () => console.log(`pause server on :${port} (chain ${chain.id})`));

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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
    if (rec.kind === "Transfer") rec.risk = await riskFacts(vault, rec.target, ev.args.amount);
    rec.summary = summary(rec);
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
  try {
    const { vault, id, approve, deadline, signature } = req.body;
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
    res.json({ ok: true, hash, execHash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.shortMessage ?? e.message });
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

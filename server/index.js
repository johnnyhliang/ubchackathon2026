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
app.use(express.json({ limit: "5mb", type: "application/json" }));

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
  tlog("stream", `QuickNode delivery received: ${logs.length} log(s)`, {
    block: req.get("batch-start-range") ?? body.metadata?.batch_start_range ?? undefined,
  });
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

// The demo scammer: a fixed, visible wallet when DEMO_SCAMMER_KEY is set, else a fresh one.
const scammerAccount = env.DEMO_SCAMMER_KEY ? privateKeyToAccount(env.DEMO_SCAMMER_KEY) : null;
const scammerAddress = () => scammerAccount?.address ?? privateKeyToAccount(generatePrivateKey()).address;
const usdcBalance = (a) => pub.readContract({ address: USDC_ADDR, abi: erc20, functionName: "balanceOf", args: [a] });
async function logScammer() {
  if (!scammerAccount) return;
  tlog("chain", `scammer wallet now holds $${usd(await usdcBalance(scammerAccount.address)).toFixed(2)}`, { address: scammerAccount.address });
}

const STEPS = {
  async trusted() {
    const grandson = getAddress(env.DEMO_TRUSTED);
    const r = await ownerPay(grandson, Number(env.DEMO_SMALL ?? 1));
    tlog("contract", r.instant ? "trusted recipient + within daily limit -> sent instantly" : "unexpected: held", {});
    return r;
  },
  async scam() {
    demo.scammer = scammerAddress();
    tlog("app", "Scam text: \"Your account is compromised. Move your savings to this safe address now.\"", {});
    const r = await ownerPay(demo.scammer, Number(env.DEMO_BIG ?? 10));
    demo.heldId = r.id;
    tlog("contract", `not trusted / over limit -> HELD as action #${r.id}; funds stay in vault`, {});
    await logScammer();
    return r;
  },
  // The same scam against an ordinary wallet: no vault, no hold, money gone.
  async unprotected() {
    const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(env.DEMO_OWNER_KEY) });
    const to = scammerAddress();
    const amt = parseUnits(String(env.DEMO_UNPROTECTED ?? 2), 6);
    tlog("app", `Without Pause: Mom sends $${usd(amt)} straight from her ordinary wallet`, { call: "USDC.transfer(scammer, amount)", note: "no vault, no rules" });
    const hash = await owner.writeContract({ address: USDC_ADDR, abi: erc20Transfer, functionName: "transfer", args: [to, amt] });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    tlog("chain", `SCAM SUCCEEDED: $${usd(amt)} arrived in block ${rcpt.blockNumber}. Nobody can reverse it.`, { tx: hash });
    await logScammer();
    return { ok: true, hash, scammer: to };
  },
  // Guardian never answers: once the hold expires, anyone can execute the payment.
  async ignored() {
    let a = demo.heldId === null ? null
      : await pub.readContract({ address: VAULTS.family, abi, functionName: "action", args: [BigInt(demo.heldId)] });
    if (!a || a.status !== 1) {
      tlog("app", "starting a fresh scam payment that the guardian will ignore", {});
      await STEPS.scam();
      a = await pub.readContract({ address: VAULTS.family, abi, functionName: "action", args: [BigInt(demo.heldId)] });
    }
    const left = Number(a.readyAt) - Math.floor(Date.now() / 1000);
    if (left > 0) {
      tlog("contract", `guardian hasn't answered; hold on #${demo.heldId} expires in ${Math.ceil(left / 60)} min`, { secondsLeft: left });
      return { ok: false, error: `Hold still running: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`, secondsLeft: left };
    }
    tlog("app", "Nobody answered the alert. The hold has expired.", {});
    const hash = await wallet.writeContract({ address: VAULTS.family, abi, functionName: "execute", args: [BigInt(demo.heldId)] });
    await pub.waitForTransactionReceipt({ hash });
    tlog("contract", `hold expired, action #${demo.heldId} executed: the scammer got paid`, { tx: hash });
    await logScammer();
    return { ok: true, hash };
  },
  // Give the scammer's winnings back to Mom so the demo can run again.
  async refund() {
    if (!scammerAccount) throw new Error("no fixed scammer wallet configured");
    const bal = await usdcBalance(scammerAccount.address);
    const fee = parseUnits("0.05", 6);
    if (bal <= fee) {
      tlog("app", "scammer wallet is empty, nothing to return", {});
      return { ok: true, returned: 0 };
    }
    const sc = createWalletClient({ chain, transport: http(), account: scammerAccount });
    const back = bal - fee;
    const hash = await sc.writeContract({ address: USDC_ADDR, abi: erc20Transfer, functionName: "transfer", args: [privateKeyToAccount(env.DEMO_OWNER_KEY).address, back] });
    await pub.waitForTransactionReceipt({ hash });
    tlog("app", `demo reset: $${usd(back).toFixed(2)} returned from scammer to Mom`, { tx: hash });
    await logScammer();
    return { ok: true, returned: usd(back) };
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

// ------------------------------------------------- live voice-clone demo
// A volunteer records ~30s, ElevenLabs clones it, the clone "approves" a held
// payment, the contract rejects it, and the clone is deleted. Consent required.
const EL = "https://api.elevenlabs.io/v1";
const clones = new Set();
const elKey = () => {
  if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");
  return env.ELEVENLABS_API_KEY;
};

app.post("/clone/create", express.raw({ type: "audio/*", limit: "20mb" }), async (req, res) => {
  try {
    if (req.query.consent !== "yes") throw new Error("volunteer consent required");
    const type = req.get("content-type") ?? "audio/webm";
    const form = new FormData();
    form.append("name", `pause-demo-${Date.now()}`);
    form.append("files", new Blob([req.body], { type }), `sample.${type.includes("mp4") ? "mp4" : "webm"}`);
    form.append("remove_background_noise", "true");
    tlog("voice", `uploading ${(req.body.length / 1024).toFixed(0)} KB voice sample to ElevenLabs Instant Voice Cloning`, { endpoint: "POST /v1/voices/add" });
    const r = await fetch(`${EL}/voices/add`, { method: "POST", headers: { "xi-api-key": elKey() }, body: form });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail?.message ?? `ElevenLabs ${r.status}`);
    clones.add(j.voice_id);
    tlog("voice", `voice cloned: ${j.voice_id}`, { note: "the clone now sounds like the volunteer" });
    res.json({ ok: true, voiceId: j.voice_id });
  } catch (e) {
    tlog("voice", `clone failed: ${e.message}`, {});
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/clone/speak", async (req, res) => {
  try {
    const { voiceId, text } = req.body;
    if (!clones.has(voiceId)) throw new Error("unknown clone");
    tlog("voice", `cloned voice says: "${text}"`, { endpoint: `POST /v1/text-to-speech/${voiceId}` });
    const r = await fetch(`${EL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2" }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
    res.set("Content-Type", "audio/mpeg").send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// The clone tries to approve the held scam payment (creating one if needed).
app.post("/clone/attempt", async (req, res) => {
  try {
    if (demo.heldId === null) await STEPS.scam();
    const held = await pub.readContract({ address: VAULTS.family, abi, functionName: "action", args: [BigInt(demo.heldId)] });
    if (held.status !== 1) await STEPS.scam();
    tlog("voice", "the cloned voice demands approval; it can produce sound, not the guardian's key", {
      bestTheScammerHas: "a signature from a key they control",
    });
    const { deadline, signature } = await signDecision(generatePrivateKey(), demo.heldId, true);
    const r = await relay(demo.heldId, true, deadline, signature);
    res.json({ ...r, actionId: String(demo.heldId) });
  } catch (e) {
    res.status(400).json({ ok: false, error: revertName(e) });
  }
});

// POST alias so the browser can delete via navigator.sendBeacon when the tab closes.
app.post("/clone/:voiceId/delete", (req, res) => deleteClone(req, res));
app.delete("/clone/:voiceId", (req, res) => deleteClone(req, res));
async function deleteClone(req, res) {
  try {
    const id = req.params.voiceId;
    const r = await fetch(`${EL}/voices/${id}`, { method: "DELETE", headers: { "xi-api-key": elKey() } });
    clones.delete(id);
    tlog("voice", r.ok ? `clone ${id} deleted from ElevenLabs` : `delete returned ${r.status}`, { endpoint: `DELETE /v1/voices/${id}` });
    res.json({ ok: r.ok });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

// Never leave a volunteer's voice behind if the server stops.
async function deleteAllClones() {
  await Promise.allSettled([...clones].map((id) =>
    fetch(`${EL}/voices/${id}`, { method: "DELETE", headers: { "xi-api-key": env.ELEVENLABS_API_KEY } })));
  process.exit(0);
}
process.on("SIGINT", deleteAllClones);
process.on("SIGTERM", deleteAllClones);

// Live balances and roles for every demo wallet and vault.
const USDC_ADDR = env.USDC ?? "0x3600000000000000000000000000000000000000";
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }];
const erc20Transfer = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];
app.get("/accounts", async (_req, res) => {
  try {
    const bal = (a) => pub.readContract({ address: USDC_ADDR, abi: erc20, functionName: "balanceOf", args: [a] }).then(usd);
    const wallets = [
      { name: "Relayer", role: "Pays network fees, relays guardian signatures, owns and guards the honeypot", address: relayer.address },
      env.DEMO_OWNER_KEY && { name: "Owner (Mom)", role: "Sends payments from the family vault", address: privateKeyToAccount(env.DEMO_OWNER_KEY).address },
      env.DEMO_GUARDIAN_KEY && { name: "Guardian", role: "Signs stop/approve decisions. Holds no money", address: privateKeyToAccount(env.DEMO_GUARDIAN_KEY).address },
      env.DEMO_TRUSTED && { name: "Grandson Leo", role: "Trusted contact; receives instant payments", address: getAddress(env.DEMO_TRUSTED) },
      scammerAccount && { name: "Scammer", role: "Where every scam in the demo tries to send the money", address: scammerAccount.address, scammer: true },
    ].filter(Boolean);
    for (const w of wallets) {
      w.balanceUsd = await bal(w.address);
      w.txCount = await pub.getTransactionCount({ address: w.address });
    }
    const vaults = [];
    for (const [name, address] of Object.entries(VAULTS)) {
      const read = (fn, args) => pub.readContract({ address, abi, functionName: fn, args });
      const [owner, guardian, dailyLimit, remainingToday, delay, count] = await Promise.all([
        read("owner"), read("guardian"), read("dailyLimit"), read("remainingToday"), read("delay"), read("actionCount"),
      ]);
      let pending = 0;
      for (let i = 0n; i < count; i++) if ((await read("action", [i])).status === 1) pending++;
      vaults.push({
        name: name === "family" ? "Family vault" : "Honeypot vault",
        address, owner, guardian,
        balanceUsd: await bal(address),
        dailyLimitUsd: usd(dailyLimit), remainingTodayUsd: usd(remainingToday),
        delaySeconds: Number(delay), actions: Number(count), pending,
      });
    }
    res.json({ chainId: chain.id, explorer: EXPLORER, usdc: USDC_ADDR, wallets, vaults });
  } catch (e) {
    res.status(500).json({ error: e.shortMessage ?? e.message });
  }
});

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

// ------------------------------------------------- app actions (keys stay here)
// The hosted demo signs for Mom and the guardian server-side so no key ships to the browser.
app.post("/app/pay", async (req, res) => {
  try {
    const to = getAddress(req.body.to);
    const amount = Number(req.body.amount);
    if (!(amount > 0)) throw new Error("Enter an amount");
    const r = await ownerPay(to, amount);
    res.json({ ok: true, instant: r.instant, id: String(r.id), hash: r.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.shortMessage ?? revertName(e) ?? e.message });
  }
});

app.post("/app/guardian-decide", async (req, res) => {
  const { id, approve } = req.body;
  const { deadline, signature } = await signDecision(env.DEMO_GUARDIAN_KEY, id, Boolean(approve));
  const r = await relay(id, Boolean(approve), deadline, signature);
  if (r.ok && approve) {
    try {
      r.execHash = await wallet.writeContract({ address: VAULTS.family, abi, functionName: "execute", args: [BigInt(id)] });
      await pub.waitForTransactionReceipt({ hash: r.execHash });
    } catch (e) { r.ok = false; r.error = revertName(e); }
  }
  res.status(r.ok ? 200 : 400).json(r);
});

const port = Number(env.PORT ?? 8787);
app.listen(port, () => console.log(`pause server on :${port} (chain ${chain.id})`));

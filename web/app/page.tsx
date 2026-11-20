"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SERVER } from "@/lib/chain";
import { countdown, fmtUsd, short, useNow, useVaultState } from "@/lib/useVaultState";
import { Terminal } from "@/components/Terminal";
import { NightScene } from "@/components/NightScene";
import { C, fill } from "@/lib/copy";

const S = C.story;
const ARC = "https://testnet.arcscan.app";
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.network";
type Scene = "ring" | "call" | "send" | "held" | "stopped";
type Tx = { label: string; hash: string; failed?: boolean };

async function post(path: string) {
  return fetch(`${SERVER}${path}`, { method: "POST" }).then((r) => r.json());
}

export default function Story() {
  const { state, refresh } = useVaultState();
  const now = useNow();
  const [scene, setScene] = useState<Scene>("ring");
  const [line, setLine] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [attacks, setAttacks] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [without, setWithout] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const addTx = (t: Tx) => t.hash && setTxs((x) => [...x, t]);
  const vault = state?.vaults.family;
  const held = state?.actions.find((a) => a.vaultName === "family" && a.id === heldId);

  const [audioOn, setAudioOn] = useState(false);

  // Captions follow the audio when call.mp3 plays, otherwise advance on a timer.
  useEffect(() => {
    if (scene !== "call") return;
    if (line >= S.callLines.length) {
      const t = setTimeout(() => setScene("send"), 3000);
      return () => clearTimeout(t);
    }
    if (audioOn) return;
    const t = setTimeout(() => setLine((l) => l + 1), 2800);
    return () => clearTimeout(t);
  }, [scene, line, audioOn]);

  function answer() {
    setScene("call");
    setLine(0);
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    a.ontimeupdate = () => a.duration && setLine(Math.min(S.callLines.length - 1, Math.floor((a.currentTime / a.duration) * S.callLines.length)));
    a.onended = () => setLine(S.callLines.length);
    a.play().then(() => setAudioOn(true)).catch(() => setAudioOn(false));
  }

  async function send() {
    setBusy("send");
    const r = await post("/demo/scam");
    setBusy(null);
    if (!r.ok) return alert(r.error);
    setHeldId(String(r.id));
    addTx({ label: "Mom sends $10, vault holds it", hash: r.hash });
    setScene("held");
    refresh();
  }

  async function unprotected() {
    setBusy("without");
    const r = await post("/demo/unprotected");
    setBusy(null);
    if (!r.ok) return alert(r.error);
    addTx({ label: "Ordinary wallet: scam succeeds", hash: r.hash });
    setWithout(fill(S.withoutResult, { amount: "$2" }));
  }

  async function attack(kind: string, label: string) {
    setBusy(kind);
    const r = await post(`/clone/attack/${kind}`);
    setBusy(null);
    setAttacks((a) => ({ ...a, [kind]: r }));
    if (r.hash) addTx({ label: `Scammer: ${label}`, hash: r.hash, failed: !r.ok });
  }

  async function stop() {
    setBusy("stop");
    const r = await post("/demo/cancel");
    setBusy(null);
    if (!r.ok) return alert(r.error);
    addTx({ label: "Guardian's phone signs Stop", hash: r.hash });
    setScene("stopped");
    refresh();
  }

  async function again() {
    setBusy("again");
    await post("/demo/refund").catch(() => {});
    setBusy(null);
    setTxs([]);
    setAttacks({});
    setWithout(null);
    setHeldId(null);
    setScene("ring");
  }

  return (
    <div className="relative left-1/2 -mt-24 min-h-screen w-screen -translate-x-1/2">
      <div className="absolute inset-0 -z-10"><NightScene /></div>
      <audio ref={audio} src="/call.mp3" preload="auto" />

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-28">
        {/* 1. The call */}
        {(scene === "ring" || scene === "call") && (
          <div className="mx-auto max-w-sm text-center">
            <p className="mb-6 font-serif text-3xl">{S.intro}</p>
            <Phone>
              <div className="py-8">
                <div className={`mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#fff4d6] text-3xl ${scene === "ring" ? "animate-pulse" : ""}`}>L</div>
                <div className="mt-3 text-xl font-semibold">{S.callerName}</div>
                <div className="text-sm text-muted">{scene === "ring" ? S.callerSub : "00:" + String(line * 3).padStart(2, "0")}</div>
              </div>
              {scene === "call" && (
                <div className="min-h-32 space-y-2 px-2 text-left">
                  {S.callLines.slice(0, line + 1).map((l, i) => (
                    <p key={i} className={`rounded-xl bg-paper px-3 py-2 text-sm transition ${i === line ? "opacity-100" : "opacity-60"}`}>{l}</p>
                  ))}
                </div>
              )}
              {scene === "ring" && (
                <div className="grid grid-cols-2 gap-3 pb-4">
                  <button disabled className="rounded-full bg-stop/80 py-3 font-semibold text-white opacity-60">{S.decline}</button>
                  <button onClick={answer} className="rounded-full bg-safe py-3 font-semibold text-white">{S.answer}</button>
                </div>
              )}
            </Phone>
            {scene === "call" && line >= S.callLines.length && <p className="mt-6 text-on-night-muted">{S.afterCall}</p>}
          </div>
        )}

        {/* 2. Mom sends */}
        {scene === "send" && (
          <div className="mx-auto max-w-sm text-center">
            <p className="font-serif text-3xl">{S.sendTitle}</p>
            <p className="mt-2 text-on-night-muted">{S.sendSub}</p>
            <Phone>
              <div className="text-left">
                <div className="text-sm text-muted">{C.wallet.balance}</div>
                <div className="font-serif text-4xl">{vault ? fmtUsd(vault.balanceUsd) : "—"}</div>
                <div className="mt-4 rounded-xl border border-dashed border-line p-3">
                  <div className="text-3xl font-semibold">$10.00</div>
                  <div className="text-xs text-muted">{S.sendTo}</div>
                </div>
                <button onClick={send} disabled={!!busy} className="mt-4 w-full rounded-xl bg-ink py-3 font-semibold text-paper disabled:opacity-50">
                  {busy === "send" ? S.sending : fill(S.sendButton, { amount: "$10" })}
                </button>
              </div>
            </Phone>
            <button onClick={unprotected} disabled={!!busy} className="mt-5 text-sm text-on-night-muted underline">
              {busy === "without" ? S.sending : S.withoutButton}
            </button>
            {without && <p className="mt-2 text-sm text-[#ff9b92]">{without} <ArcLink hash={txs.at(-1)?.hash} /></p>}
          </div>
        )}

        {/* 3. Held: three sides at once */}
        {scene === "held" && (
          <div>
            <div className="mx-auto mb-6 max-w-2xl text-center">
              <p className="font-serif text-4xl">{S.heldTitle}</p>
              <p className="mt-2 text-on-night-muted">{S.heldSub}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title={S.momPhone}>
                <div className="font-serif text-4xl">$10.00</div>
                <div className="mt-1 rounded-md bg-[#fff4d6] px-2 py-1 text-sm font-medium text-held">
                  {fill(S.momHeld, { time: held ? countdown(held.readyAt, now) : "10:00" })}
                </div>
                {held?.risk?.reasons && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {held.risk.reasons.map((r) => <span key={r} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{r}</span>)}
                  </div>
                )}
                {held && <div className="mt-2 text-xs text-muted">to <a className="underline" target="_blank" rel="noreferrer" href={`${ARC}/address/${held.target}`}>{short(held.target)} ↗</a></div>}
              </Panel>

              <Panel title={S.scammerPanel} tone="stop">
                <p className="mb-3 text-xs text-muted">{S.scammerSub}</p>
                <div className="space-y-2">
                  {C.clone.attacks.map((a) => {
                    const r = attacks[a.key];
                    return (
                      <button key={a.key} onClick={() => attack(a.key, a.label)} disabled={!!busy}
                        title={a.desc}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-ink disabled:opacity-50">
                        <span>{a.label}</span>
                        <span className={`shrink-0 text-xs font-semibold ${r ? (r.ok ? "text-stop" : "text-safe") : "text-muted"}`}>
                          {busy === a.key ? "…" : r ? (r.ok ? "accepted?!" : `✗ ${r.error}`) : "try"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel title={S.guardianPhone} tone="safe">
                <p className="font-medium">{fill(S.guardianAlert, { amount: "$10" })}</p>
                <p className="mt-1 text-xs text-muted">{C.guardian.signedNote}</p>
                <button onClick={stop} disabled={!!busy} className="mt-4 w-full rounded-xl bg-ink py-3 font-semibold text-paper disabled:opacity-50">
                  {busy === "stop" ? S.guardianStopping : S.guardianStop}
                </button>
                <Link href="/guardian" target="_blank" className="mt-2 block text-center text-xs text-muted underline">{C.voiceBriefing.incoming} ↗</Link>
              </Panel>
            </div>
            <Terminal title={S.feedTitle} className="mt-4 h-72" fresh />
          </div>
        )}

        {/* 4. Stopped + verify */}
        {scene === "stopped" && (
          <div className="mx-auto max-w-2xl">
            <p className="text-center font-serif text-5xl">{S.stoppedTitle}</p>
            <p className="mx-auto mt-3 max-w-[50ch] text-center text-on-night-muted">{S.stoppedSub}</p>

            <div className="mt-8 rounded-2xl bg-card p-5">
              <div className="font-serif text-2xl">{S.verifyTitle}</div>
              <p className="text-sm text-muted">{S.verifySub}</p>
              {vault && (
                <div className="mt-4 text-sm">
                  <div className="text-xs text-muted">{S.verifyVault}</div>
                  <a className="break-all font-mono underline" target="_blank" rel="noreferrer" href={`${ARC}/address/${vault.address}`}>{vault.address} ↗</a>
                </div>
              )}
              <div className="mt-4 text-xs text-muted">{S.verifyTxs}</div>
              <ul className="mt-1 space-y-1 text-sm">
                {txs.map((t) => (
                  <li key={t.hash} className="flex justify-between gap-3">
                    <span className={t.failed ? "text-stop" : ""}>{t.failed ? "✗ " : "✓ "}{t.label}</span>
                    <ArcLink hash={t.hash} />
                  </li>
                ))}
              </ul>
              {vault && (
                <>
                  <div className="mt-4 text-xs text-muted">{S.verifyCli}</div>
                  <pre className="mt-1 overflow-x-auto rounded-xl bg-zinc-950 p-3 font-code text-xs text-zinc-200">{`cast call ${vault.address} "guardian()(address)" --rpc-url ${RPC}
cast call ${vault.address} "balance()(uint256)" --rpc-url ${RPC}`}</pre>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={again} disabled={!!busy} className="rounded-xl bg-on-night px-5 py-3 font-semibold text-ink disabled:opacity-50">
                {busy === "again" ? S.resetting : S.again}
              </button>
              <Link href="/overview" className="rounded-xl border border-white/20 px-5 py-3 font-semibold">{S.explore}</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-xs rounded-[2.5rem] border-8 border-zinc-900 bg-card p-5 text-ink shadow-[0_30px_80px_rgba(0,0,0,.55)]">
      {children}
    </div>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: "safe" | "stop"; children: React.ReactNode }) {
  const ring = tone === "stop" ? "ring-2 ring-stop/40" : tone === "safe" ? "ring-2 ring-safe/40" : "";
  return (
    <div className={`rounded-2xl bg-card p-5 text-ink ${ring}`}>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function ArcLink({ hash }: { hash?: string }) {
  if (!hash) return null;
  return <a href={`${ARC}/tx/${hash}`} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs underline">{hash.slice(0, 10)}… ↗</a>;
}

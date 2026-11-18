"use client";
import Link from "next/link";
import { NightScene } from "@/components/NightScene";
import { fmtUsd, short, countdown, useNow, useVaultState } from "@/lib/useVaultState";

export default function Landing() {
  const { state } = useVaultState();
  const now = useNow();
  const held = state?.actions.find((a) => a.vaultName === "family" && a.status === "Pending" && a.kind === "Transfer");
  const attempts = state?.honeypot.attempts ?? 0;

  return (
    <div className="relative left-1/2 -mt-24 w-screen -translate-x-1/2">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <NightScene />
        </div>
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-24 pt-40 text-center sm:pb-32">
          <h1 className="font-serif text-[clamp(44px,8vw,92px)] [text-shadow:0_2px_30px_rgba(7,10,22,.6)]">
            Scammers rush.
            <br />
            We make them wait.
          </h1>
          <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-on-night-muted">
            Unusual payments hold for ten minutes while someone you trust takes a look. A cloned voice can&apos;t approve them.
          </p>

          <div className="mt-9 w-full max-w-md rounded-2xl bg-card p-4 text-left shadow-[0_30px_60px_rgba(0,0,0,.45)]">
            <div className="text-sm text-muted">Mom is sending</div>
            <div className="mt-1.5 flex items-baseline justify-between rounded-xl border border-dashed border-[#c4c8d4] px-3 py-3">
              <span className="text-3xl font-semibold tracking-tight">{fmtUsd(held?.amountUsd ?? 2000)}</span>
              <span className="rounded-md bg-[#fff4d6] px-2 py-1 text-sm font-medium text-held">
                Held · {held ? countdown(held.readyAt, now) : "9:41"}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(held?.risk?.reasons ?? ["new address", "never paid before", "20x her daily limit"]).map((r) => (
                <span key={r} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{r}</span>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted">To {held ? short(held.target) : "0x91f2…ae07"}</div>
            <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-2">
              <Link href="/guardian" className="rounded-xl bg-ink px-4 py-3 text-center font-semibold text-on-night">Stop payment</Link>
              <Link href="/guardian" className="rounded-xl border border-line px-4 py-3 text-center font-semibold">Send now</Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="font-serif text-4xl">Three steps, ten minutes</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { t: "It holds", d: "A big amount, or an address Mom has never paid, waits instead of leaving. Everyday payments to family still go straight through." },
            { t: "You hear about it", d: "Your phone rings. A voice explains what's happening and why it looks wrong, and answers your questions." },
            { t: "You decide", d: "Stop it or let it through with one tap. That tap is signed by your phone, so a copy of your voice can't do it for you." },
          ].map((s) => (
            <div key={s.t} className="rounded-2xl border border-white/10 bg-white/[.04] p-5">
              <div className="text-lg font-semibold">{s.t}</div>
              <p className="mt-2 text-on-night-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Proof */}
      <section className="mx-auto grid max-w-5xl gap-6 px-4 pb-24 sm:grid-cols-[1.2fr_1fr] sm:items-center">
        <div>
          <h2 className="font-serif text-4xl">We handed out the keys</h2>
          <p className="mt-3 max-w-[46ch] text-on-night-muted">
            The demo wallet holds real testnet dollars, and anyone can use its owner key to send them anywhere.
            {attempts > 0 ? ` ${attempts} people have tried so far. None of them got a cent.` : " Nobody has managed to take a cent."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/steal" className="rounded-xl bg-on-night px-5 py-3 font-semibold text-ink">Try to steal it</Link>
            <Link href="/clone" className="rounded-xl border border-white/20 px-5 py-3 font-semibold">Clone a voice</Link>
            <Link href="/console" className="rounded-xl px-5 py-3 font-semibold text-on-night-muted hover:text-on-night">See how it works</Link>
          </div>
        </div>
        <div className="rounded-2xl bg-card p-5">
          <div className="text-sm text-muted">Demo wallet</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight">{fmtUsd(state?.vaults.honeypot.balanceUsd ?? 1000)}</div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div><div className="text-sm text-muted">Attempts</div><div className="text-2xl font-semibold">{attempts}</div></div>
            <div><div className="text-sm text-muted">Taken</div><div className="text-2xl font-semibold text-safe">$0</div></div>
          </div>
        </div>
      </section>
    </div>
  );
}

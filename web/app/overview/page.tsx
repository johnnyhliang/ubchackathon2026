"use client";
import { C, fill } from "@/lib/copy";
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
            {C.landing.heroLine1}
            <br />
            {C.landing.heroLine2}
          </h1>
          <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-on-night-muted">
            {C.landing.heroSub}
          </p>

          <div className="mt-9 w-full max-w-md rounded-2xl bg-card p-4 text-left shadow-[0_30px_60px_rgba(0,0,0,.45)]">
            <div className="text-sm text-muted">{C.landing.cardLabel}</div>
            <div className="mt-1.5 flex items-baseline justify-between rounded-xl border border-dashed border-[#c4c8d4] px-3 py-3">
              <span className="text-3xl font-semibold tracking-tight">{fmtUsd(held?.amountUsd ?? 2000)}</span>
              <span className="rounded-md bg-[#fff4d6] px-2 py-1 text-sm font-medium text-held">
                {fill(C.landing.heldBadge, { time: held ? countdown(held.readyAt, now) : "9:41" })}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(held?.risk?.reasons ?? C.landing.fallbackReasons).map((r) => (
                <span key={r} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{r}</span>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted">{fill(C.landing.toLabel, { address: held ? short(held.target) : "0x91f2…ae07" })}</div>
            <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-2">
              <Link href="/guardian" className="rounded-xl bg-ink px-4 py-3 text-center font-semibold text-on-night">{C.landing.stopButton}</Link>
              <Link href="/guardian" className="rounded-xl border border-line px-4 py-3 text-center font-semibold">{C.landing.sendButton}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="font-serif text-4xl">{C.landing.howTitle}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {C.landing.how.map((s) => (
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
          <h2 className="font-serif text-4xl">{C.landing.proofTitle}</h2>
          <p className="mt-3 max-w-[46ch] text-on-night-muted">
            {C.landing.proofBody}{" "}
            {attempts > 0 ? fill(C.landing.proofAttempts, { n: attempts }) : C.landing.proofNoAttempts}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/steal" className="rounded-xl bg-on-night px-5 py-3 font-semibold text-ink">{C.landing.ctaSteal}</Link>
            <Link href="/clone" className="rounded-xl border border-white/20 px-5 py-3 font-semibold">{C.landing.ctaClone}</Link>
            <Link href="/console" className="rounded-xl px-5 py-3 font-semibold text-on-night-muted hover:text-on-night">{C.landing.ctaConsole}</Link>
          </div>
        </div>
        <div className="rounded-2xl bg-card p-5">
          <div className="text-sm text-muted">{C.landing.demoWallet}</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight">{fmtUsd(state?.vaults.honeypot.balanceUsd ?? 1000)}</div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div><div className="text-sm text-muted">{C.landing.attempts}</div><div className="text-2xl font-semibold">{attempts}</div></div>
            <div><div className="text-sm text-muted">{C.landing.taken}</div><div className="text-2xl font-semibold text-safe">$0</div></div>
          </div>
        </div>
      </section>
    </div>
  );
}

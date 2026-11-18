"use client";
import { useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { GUARDIAN_KEY, impostorKey, signAndRelay } from "@/lib/chain";
import { type Action, countdown, fmtUsd, short, useNow, useVaultState } from "@/lib/useVaultState";
import { ActionRow, Card, TxLink } from "@/components/ui";
import { VoiceBriefing } from "@/components/VoiceBriefing";

export default function GuardianPage() {
  return (
    <ConversationProvider>
      <Guardian />
    </ConversationProvider>
  );
}

function Guardian() {
  const { state, refresh } = useVaultState();
  const now = useNow();
  const family = state?.actions.filter((a) => a.vaultName === "family") ?? [];
  const pending = family.filter((a) => a.status === "Pending");
  const past = family.filter((a) => a.status !== "Pending");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-4xl">You&apos;re Mom&apos;s guardian</h1>
        <p className="text-sm text-muted">
          You can stop or approve her held payments. You can never move her money yourself.
        </p>
      </div>

      {pending.length === 0 && (
        <Card>
          <p className="text-muted">All quiet. Nothing is waiting for you.</p>
        </Card>
      )}

      {pending.map((a) => (
        <HeldCard key={a.id} a={a} now={now} explorer={state!.explorer} onDone={refresh} />
      ))}

      {past.length > 0 && (
        <Card>
          <h2 className="mb-1 font-serif text-2xl">History</h2>
          <ul>
            {past.map((a) => (
              <ActionRow key={a.id} a={a} now={now} explorer={state!.explorer} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function HeldCard({ a, now, explorer, onDone }: { a: Action; now: number; explorer: string; onDone: () => void }) {
  const [busy, setBusy] = useState<null | "approve" | "cancel" | "impostor">(null);
  const [result, setResult] = useState<{ tone: string; text: string; hash?: string } | null>(null);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "cancel");
    const r = await signAndRelay(GUARDIAN_KEY, a.vault, a.id, approve);
    setBusy(null);
    setResult(
      r.ok
        ? { tone: approve ? "safe" : "stop", text: approve ? "Approved and sent." : "Stopped. The money stays in Mom's wallet.", hash: r.execHash ?? r.hash }
        : { tone: "stop", text: r.error ?? "Failed" }
    );
    onDone();
  }

  // Deepfake demo: an approval that does not come from the guardian's phone.
  async function impostor() {
    setBusy("impostor");
    const r = await signAndRelay(impostorKey(), a.vault, a.id, true);
    setBusy(null);
    setResult(
      r.ok
        ? { tone: "stop", text: "Unexpected: impostor approval accepted." }
        : { tone: "safe", text: "Rejected by the contract: \"approve it\" from a cloned voice carries no signature from your phone." }
    );
  }

  const high = a.risk?.level === "high";
  return (
    <Card className={high ? "border-stop/60" : "border-held/60"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-xs font-semibold uppercase tracking-wide ${high ? "text-stop" : "text-held"}`}>
            {high ? "Looks like a scam" : "Needs a look"}
          </div>
          <div className="mt-1 font-serif text-3xl">
            {a.kind === "Transfer" ? `Mom is sending ${fmtUsd(a.amountUsd)}` : a.summary}
          </div>
          {a.kind === "Transfer" && <div className="font-mono text-sm text-muted">to {short(a.target)}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl tabular-nums">{countdown(a.readyAt, now)}</div>
          <div className="text-xs text-muted">until it goes through</div>
        </div>
      </div>

      {a.risk && a.risk.reasons.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {a.risk.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="text-stop">●</span> {r}
            </li>
          ))}
        </ul>
      )}

      <VoiceBriefing a={a} secondsLeft={Math.max(0, a.readyAt - now)} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => decide(false)}
          disabled={!!busy}
          className="rounded-xl bg-ink px-4 py-3 font-semibold text-paper disabled:opacity-50"
        >
          {busy === "cancel" ? "Stopping…" : "Stop payment"}
        </button>
        <button
          onClick={() => decide(true)}
          disabled={!!busy}
          className="rounded-xl border border-line px-4 py-3 font-medium disabled:opacity-50"
        >
          {busy === "approve" ? "Approving…" : "It's fine, send now"}
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted">Your tap is signed by this phone. That signature is the only thing the vault accepts.</p>

      <button onClick={impostor} disabled={!!busy} className="mt-3 w-full text-xs text-muted underline">
        {busy === "impostor" ? "Trying…" : "Demo: try approving with a cloned voice (no phone signature)"}
      </button>

      {result && (
        <p className={`mt-3 text-sm text-${result.tone}`}>
          {result.text} <TxLink hash={result.hash} explorer={explorer} />
        </p>
      )}
    </Card>
  );
}

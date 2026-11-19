"use client";
import { C } from "@/lib/copy";
import { useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { SERVER } from "@/lib/chain";
import { type Action, fmtUsd } from "@/lib/useVaultState";

/**
 * Talk to the ElevenLabs guardian agent about a held payment. The agent explains
 * the risk and answers questions, but has no tool that can approve: decisions
 * only happen through the signed buttons.
 *
 * Agent setup (ElevenLabs dashboard): first message / prompt should use the
 * dynamic variables {{owner_name}}, {{amount}}, {{recipient}}, {{reasons}}, {{minutes_left}}.
 */
export function VoiceBriefing({ a, secondsLeft }: { a: Action; secondsLeft: number }) {
  const [err, setErr] = useState<string | null>(null);
  const convo = useConversation({ onError: (m) => setErr(String(m)) });
  const live = convo.status === "connected" || convo.status === "connecting";

  async function start() {
    setErr(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = await fetch(`${SERVER}/voice/signed-url`);
      const j = await r.json();
      if (!j.signedUrl) throw new Error(j.error ?? "voice unavailable");
      convo.startSession({
        signedUrl: j.signedUrl,
        dynamicVariables: {
          owner_name: "Mom",
          amount: fmtUsd(a.amountUsd),
          recipient: `${a.target.slice(0, 6)}…${a.target.slice(-4)}`,
          reasons: a.risk?.reasons.join("; ") || "none",
          minutes_left: Math.ceil(secondsLeft / 60),
        },
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="mt-4 rounded-xl bg-paper p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-full bg-[#fff4d6] ${live ? "" : "ring"}`} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a5a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg></span>
          <div className="text-sm">
            <div className="font-medium">{live ? (convo.isSpeaking ? C.voiceBriefing.speaking : C.voiceBriefing.listening) : C.voiceBriefing.incoming}</div>
            <div className="text-xs text-muted">{C.voiceBriefing.sub}</div>
          </div>
        </div>
        {live ? (
          <button onClick={() => convo.endSession()} className="rounded-full border border-line px-4 py-1.5 text-sm">
            {C.voiceBriefing.hangUp}
          </button>
        ) : (
          <button onClick={start} className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
            {C.voiceBriefing.answer}
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-stop">{err}</p>}
    </div>
  );
}

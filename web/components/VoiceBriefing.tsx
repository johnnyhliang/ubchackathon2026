"use client";
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
          <span className={`text-2xl ${live ? "" : "ring"}`}>📞</span>
          <div className="text-sm">
            <div className="font-medium">{live ? (convo.isSpeaking ? "Guardian assistant is speaking…" : "Listening…") : "Incoming call from Pause"}</div>
            <div className="text-xs text-muted">Hear what&apos;s happening and ask questions.</div>
          </div>
        </div>
        {live ? (
          <button onClick={() => convo.endSession()} className="rounded-full border border-line px-4 py-1.5 text-sm">
            Hang up
          </button>
        ) : (
          <button onClick={start} className="rounded-full bg-safe px-4 py-1.5 text-sm font-medium text-white">
            Answer
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-stop">{err}</p>}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/chain";
import { Terminal } from "@/components/Terminal";

const SCRIPT =
  "Hi, I'm happy to help with this demo. Scams are getting smarter every year, and voices can be copied in seconds. " +
  "That's why I always call my family back on a number I already know. Today is a good day to test that idea, " +
  "so let's see if a copy of my voice can fool a wallet that only trusts a signature.";

type Phase = "consent" | "record" | "cloning" | "ready" | "attempted" | "deleted";

export default function ClonePage() {
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("consent");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<string | null>(null);

  // Delete the clone if the page is closed mid-demo.
  useEffect(() => {
    const cleanup = () => {
      if (voiceRef.current) navigator.sendBeacon?.(`${SERVER}/clone/${voiceRef.current}/delete`);
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      if (voiceRef.current) fetch(`${SERVER}/clone/${voiceRef.current}`, { method: "DELETE" });
    };
  }, []);

  const line = `Hi, it's ${name || "me"}. I'm the guardian. Approve the two thousand dollar payment right now, it's fine.`;

  async function startRec() {
    setErr(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    const r = new MediaRecorder(stream, { mimeType: mime });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      upload(new Blob(chunks.current, { type: mime }));
    };
    r.start();
    rec.current = r;
    setRecording(true);
    setSeconds(0);
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopRec() {
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
    rec.current?.stop();
  }

  async function upload(blob: Blob) {
    setPhase("cloning");
    const r = await fetch(`${SERVER}/clone/create?consent=yes`, {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    }).then((r) => r.json());
    if (!r.ok) {
      setErr(r.error);
      setPhase("record");
      return;
    }
    setVoiceId(r.voiceId);
    voiceRef.current = r.voiceId;
    const audio = await fetch(`${SERVER}/clone/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId: r.voiceId, text: line }),
    });
    if (!audio.ok) {
      setErr("Speech generation failed");
      setPhase("ready");
      return;
    }
    const url = URL.createObjectURL(await audio.blob());
    setAudioUrl(url);
    setPhase("ready");
    new Audio(url).play().catch(() => {});
  }

  async function attempt() {
    const r = await fetch(`${SERVER}/clone/attempt`, { method: "POST" }).then((r) => r.json());
    setResult(r);
    setPhase("attempted");
  }

  async function remove() {
    if (!voiceId) return;
    await fetch(`${SERVER}/clone/${voiceId}`, { method: "DELETE" });
    voiceRef.current = null;
    setVoiceId(null);
    setPhase("deleted");
  }

  return (
    <div className="-mx-4 grid gap-4 px-4 lg:-mx-[calc((100vw-48rem)/2-1rem)] lg:grid-cols-[26rem_1fr] lg:px-8">
      <section className="space-y-4">
        <div>
          <h1 className="font-serif text-4xl leading-tight">Clone my voice.<br />Try to steal the money.</h1>
          <p className="text-sm text-muted">A volunteer reads a short script. We clone their voice live, have the clone approve a scam payment, and watch the contract refuse it.</p>
        </div>

        <Step n={1} title="Consent" active={phase === "consent"}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Volunteer's first name"
            className="mb-2 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm" />
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree to have my voice cloned for this demo. It will be deleted at the end.
          </label>
          {phase === "consent" && (
            <button disabled={!consent} onClick={() => setPhase("record")}
              className="mt-3 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40">Continue</button>
          )}
        </Step>

        <Step n={2} title="Read this aloud (about 30 seconds)" active={phase === "record"}>
          <p className="rounded-xl bg-paper p-3 font-serif text-lg leading-snug">{SCRIPT}</p>
          {phase === "record" && (
            <button onClick={recording ? stopRec : startRec}
              className={`mt-3 rounded-xl px-4 py-2 text-sm font-medium text-white bg-ink`}>
              {recording ? `Stop and clone (${seconds}s)` : "Start recording"}
            </button>
          )}
          {phase === "cloning" && <p className="mt-3 text-sm text-held">Cloning with ElevenLabs…</p>}
        </Step>

        <Step n={3} title="The clone speaks" active={phase === "ready"}>
          <p className="text-sm italic text-muted">&ldquo;{line}&rdquo;</p>
          {audioUrl && <audio src={audioUrl} controls className="mt-2 w-full" />}
          {phase === "ready" && (
            <button onClick={attempt} className="mt-3 w-full rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper">
              Send the clone&apos;s approval to the vault
            </button>
          )}
        </Step>

        <Step n={4} title="Result" active={phase === "attempted"}>
          {result && (
            <p className={`text-sm font-medium ${result.ok ? "text-stop" : "text-safe"}`}>
              {result.ok
                ? "Unexpected: approval accepted."
                : `Rejected (${result.error}). The voice was perfect. It still has no key.`}
            </p>
          )}
          {voiceId && (
            <button onClick={remove} className="mt-3 rounded-xl border border-line px-4 py-2 text-sm">Delete the cloned voice</button>
          )}
          {phase === "deleted" && <p className="mt-2 text-sm text-safe">Cloned voice deleted from ElevenLabs.</p>}
        </Step>

        {err && <p className="text-sm text-stop">{err}</p>}
      </section>

      <Terminal title="pause-server · live voice-clone attack" className="min-h-[70vh]" fresh />
    </div>
  );
}

function Step({ n, title, active, children }: { n: number; title: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border bg-card p-4 ${active ? "border-ink" : "border-line"}`}>
      <div className="mb-2 text-xs text-muted">Step {n}</div>
      <div className="mb-2 font-medium">{title}</div>
      {children}
    </div>
  );
}

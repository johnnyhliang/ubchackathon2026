"use client";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { ownerPay } from "@/lib/chain";
import { fmtUsd, useNow, useVaultState } from "@/lib/useVaultState";
import { ActionRow, Card } from "@/components/ui";

// Demo contacts. The grandson is trusted on the vault by the setup script.
const CONTACTS: { name: string; address: string }[] = (process.env.NEXT_PUBLIC_CONTACTS ?? "")
  .split(",")
  .filter(Boolean)
  .map((s) => {
    const [name, address] = s.split(":");
    return { name, address };
  });

export default function WalletPage() {
  const { state, error, refresh } = useVaultState();
  const now = useNow();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "safe" | "held" | "stop"; text: string } | null>(null);

  const v = state?.vaults.family;
  const actions = state?.actions.filter((a) => a.vaultName === "family") ?? [];

  async function send() {
    if (!v) return;
    if (!isAddress(to)) return setMsg({ tone: "stop", text: "That doesn't look like a valid address." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await ownerPay(to as Address, amount || "0");
      if (!r.ok) throw { shortMessage: r.error };
      const instant = r.instant;
      setMsg(
        instant
          ? { tone: "safe", text: `Sent ${fmtUsd(Number(amount))}.` }
          : {
              tone: "held",
              text: `This payment is on hold for ${Math.round(v.delaySeconds / 60)} minutes. Your guardian has been told.`,
            }
      );
      setAmount("");
      refresh();
    } catch (e) {
      setMsg({ tone: "stop", text: (e as { shortMessage?: string }).shortMessage ?? "Payment failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-stop">{error}</p>}
      <Card>
        <div className="text-sm text-muted">Your balance</div>
        <div className="font-serif text-6xl">{v ? fmtUsd(v.balanceUsd) : "—"}</div>
        {v && (
          <p className="mt-2 text-sm text-muted">
            You can send up to <b className="text-ink">{fmtUsd(v.remainingTodayUsd)}</b> instantly today to people you trust.
            Anything else waits {Math.round(v.delaySeconds / 60)} minutes so your guardian can check it.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-serif text-2xl">Send money</h2>
        {CONTACTS.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {CONTACTS.map((c) => (
              <button
                key={c.address}
                onClick={() => setTo(c.address)}
                className={`rounded-full border px-3 py-1 text-sm ${to === c.address ? "border-ink bg-ink text-paper" : "border-line"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="Recipient address (0x…)"
            className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-sm"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="$ amount"
            inputMode="decimal"
            className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 sm:w-32"
          />
          <button
            onClick={send}
            disabled={busy || !amount || !to}
            className="rounded-xl bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        {msg && <p className={`mt-3 text-sm text-${msg.tone}`}>{msg.text}</p>}
      </Card>

      <Card>
        <h2 className="mb-1 font-serif text-2xl">Activity</h2>
        {actions.length === 0 ? (
          <p className="text-sm text-muted">Nothing held yet.</p>
        ) : (
          <ul>
            {actions.map((a) => (
              <ActionRow key={a.id} a={a} now={now} explorer={state!.explorer} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

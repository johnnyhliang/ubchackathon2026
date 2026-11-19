// QuickNode Streams filter (dataset: Receipts, network: Arc Testnet).
// Paste into the Stream's "Filter" step. Keeps only logs emitted by our vaults
// and returns { logs: [...] } for the /webhook/quicknode destination.
function main(stream) {
  const VAULTS = [
    "0x1d623326c71f28aca7e00c0274ae9d94913bd7b5",
    "0xdadbf921bead72c374107c473f5157fdd3e6afd1",
  ];
  const receipts = Array.isArray(stream.data) ? stream.data.flat(2) : [];
  const logs = [];
  for (const r of receipts) {
    for (const l of r.logs || []) {
      if (VAULTS.includes((l.address || "").toLowerCase())) logs.push(l);
    }
  }
  return logs.length ? { logs } : null;
}

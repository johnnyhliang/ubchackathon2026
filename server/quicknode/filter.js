// QuickNode Streams filter (dataset: Receipts, network: Arc Testnet).
// Paste into the Stream's "Filter" step. Keeps only logs emitted by our vaults
// and returns { logs: [...] } for the /webhook/quicknode destination.
function main(stream) {
  const VAULTS = [
    "0x8a03b3383c0b21c3fe95c1a2198e71723d3395da",
    "0x7a42c08ed0cf53116296785dd97ec52d1914c607",
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

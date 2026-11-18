// QuickNode Streams filter (dataset: Receipts, network: Arc Testnet).
// Paste into the Stream's "Filter" step. Keeps only logs emitted by our vaults
// and returns { logs: [...] } for the /webhook/quicknode destination.
function main(stream) {
  const VAULTS = [
    "0xFAMILY_VAULT_ADDRESS_LOWERCASE",
    "0xHONEYPOT_VAULT_ADDRESS_LOWERCASE",
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

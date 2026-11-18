# Pause

**A USDC wallet that calls someone you trust before a scammer gets paid.**

Scammers can fake your daughter's voice. They can't fake her phone.

Pause is a vault contract on Arc. Small payments to people you've paid before go through instantly. Anything else (a large amount, a brand-new address, or any attempt to weaken the protection) is held for a few minutes. A trusted guardian gets an alert and a voice briefing, and can stop the payment or approve it early with a signed tap. The guardian can never move the money themselves, and a cloned voice saying "approve it" does nothing, because only a signature from the guardian's device counts.

UBC 2026 Hackathon: **Consumer Applications** track · **Best use of Arc** · ElevenLabs bounty · QuickNode Streams bounty.

## What problem it solves

- Most 2026 crypto losses came from stolen keys and social engineering, not smart-contract bugs.
- Once a stablecoin payment is sent, it is final. Freezes by the issuer are slow and rare.
- Exchanges such as Coinbase now offer trusted-contact approvals, but only for money held on their platform. Pause is a contract any wallet or app can use.

## How it works

```
 Mom's app ──pay()──▶ GuardianVault (Arc)
                        │  trusted + under daily limit → sent instantly
                        │  otherwise → ActionQueued (held for `delay`)
                        ▼
              QuickNode Stream (Arc testnet, receipts, filtered to vault logs)
                        │  webhook
                        ▼
                 Pause server ── risk facts (new address? x daily limit? odd hour?)
                        │  live updates (SSE)
                        ▼
              Guardian app ── ElevenLabs voice agent explains the payment
                        │  tap → EIP-712 signature (guardian's key)
                        ▼
              server relays decideBySig() → cancel, or approve + execute
```

### Contract rules (`contracts/src/GuardianVault.sol`)

| Action by owner | Result |
|---|---|
| Pay a trusted recipient within the daily limit | Instant |
| Pay anyone else, or over the limit | Held for `delay`, then executable by anyone |
| Trust a new recipient, raise the limit, change the guardian | Held, so the guardian can cancel |
| Remove a trusted recipient, lower the limit | Instant (only tightens protection) |

The guardian can `cancel` or `approve` (skip the wait) held actions, directly or by an EIP-712 signature relayed by anyone (`decideBySig`). Signatures are verified with OpenZeppelin `SignatureChecker`, so the guardian can be an EOA or an ERC-1271 smart account such as a passkey wallet. The guardian has no function that sends funds.

**Limits:** an attacker who only sends small amounts to recipients that are already trusted is not stopped, and if the guardian ignores the alert, a held payment goes through after the delay.

## Repo layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: `GuardianVault`, tests, deploy scripts |
| `server/` | Node backend: event intake (QuickNode webhook + local poller), risk scoring, signature relay, honeypot, ElevenLabs signed URLs |
| `server/quicknode/filter.js` | Stream filter |
| `server/scripts/e2e.js` | End-to-end check against a running chain and server |
| `web/` | Next.js app: `/` wallet, `/guardian`, `/steal` (public honeypot) |
| `IDEAS.md` | Ideas considered and why this one |

## Run locally

Requires Node 20+ and [Foundry](https://getfoundry.sh).

```bash
# 1. chain + contracts
cd contracts && forge test
anvil                                    # separate terminal
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
#    → prints FAMILY_VAULT and HONEYPOT_VAULT

# 2. server
cd ../server && npm i
cp .env.example .env                     # paste the two vault addresses
npm start
node scripts/e2e.js                      # optional: full flow check

# 3. web
cd ../web && npm i
cp .env.example .env.local
npm run dev                              # http://localhost:3000
```

## Demo walkthrough

Open **http://localhost:3000/console** ("Under the hood"). The left side steps through the scenario. The right side is a live terminal fed by the server, with color-coded layers: `app`, `chain`, `stream` (QuickNode), `risk`, `voice` (ElevenLabs), `relay` (signatures) and `contract`.

| Step | Click | What the terminal shows |
|---|---|---|
| 1. Normal day | Run "Normal day" | `pay()` call → tx mined → `InstantPayment`. Trusted + under limit = instant |
| 2. The scam | Run "The scam" | `pay()` → **HELD as action #n** → `ActionQueued` event arrives (poller or QuickNode) → risk scored HIGH with reasons → guardian alerted |
| 3. The deepfake | Run "The deepfake" | EIP-712 decision received → `recoveredSigner` ≠ `vaultGuardian` (`match: false`) → **decideBySig REVERTED: BadSignature** |
| 4. The real guardian | Run "The real guardian" | Signature from the guardian's key (`match: true`) → cancelled → vault balance unchanged |
| 5. The workaround | Run "The workaround" | `requestGuardian(scammer)` is itself held → guardian cancels it |

Then show the consumer side:

1. **`/`** (Mom's wallet): send $20 to *Grandson Leo* (instant), then $2,000 to any new `0x` address (held).
2. **`/guardian`** (open on a phone or a second window): the held payment appears with its warning signs and a countdown. Tap **Answer** for the ElevenLabs voice briefing. Tap **"try approving with a cloned voice"** to see it rejected. Tap **Stop payment**.
3. **`/steal`**: anyone enters an address and tries to drain the honeypot; the counter goes up and "Stolen" stays $0.

### Live voice-clone attack (`/clone`)

Shows that a *perfect* copy of a voice still can't move money. Needs `ELEVENLABS_API_KEY` on a plan that includes Instant Voice Cloning.

1. A volunteer types their first name and ticks the consent box.
2. They tap **Start recording**, read the on-screen script (about 30 s), and tap **Stop and clone**. The server uploads the sample to ElevenLabs Instant Voice Cloning (`POST /v1/voices/add`).
3. The clone plays automatically: *"Hi, it's {name}. I'm the guardian. Approve the two thousand dollar payment…"* (`POST /v1/text-to-speech/{voice_id}`).
4. Tap **Send the clone's approval to the vault**. If no scam payment is held, one is created first. The terminal shows the recovered signer ≠ guardian and **decideBySig REVERTED: BadSignature**.
5. Tap **Delete the cloned voice** (`DELETE /v1/voices/{voice_id}`). Clones are also deleted when the page closes or the server stops.

Backup for a noisy room: clone your own voice beforehand and do the run-through yourself.

Suggested video order (2–3 min): `/steal` counter as the hook → Mom's wallet scam → guardian phone rings and voice explains → cloned voice rejected → Stop → `/console` replay for the technical audience → architecture slide.

Resetting a local demo: stop `anvil`, start it again, rerun `DeployLocal.s.sol` (same addresses every time) and restart the server.

## Deploy to Arc testnet

1. Create three keys: deployer/relayer, owner ("Mom"), guardian. Fund the relayer and owner from https://faucet.circle.com (select Arc Testnet). USDC is Arc's gas token. If the faucet fails, try the Circle Developer Console faucet or ask in the hackathon Telegram. Only the relayer and owner need funds; the guardian never pays gas.
2. Deploy, using the RPC URL from https://docs.arc.io (Connect to Arc):
   ```bash
   cd contracts
   OWNER=0x… GUARDIAN=0x… forge script script/Deploy.s.sol \
     --rpc-url $ARC_RPC --private-key $RELAYER_KEY --broadcast
   # honeypot: OWNER and GUARDIAN both = relayer address, DAILY_LIMIT=0
   ```
3. Send testnet USDC to both vaults. Trust the demo contact: owner calls `requestTrust`, guardian calls `approve`, anyone calls `execute`.
4. Fill in `server/.env` and `web/.env.local` with the Arc chain ID (5042002), RPC, explorer, and addresses.

### Deployed contracts (Arc testnet)

| Contract | Address |
|---|---|
| USDC (Arc native, ERC-20 interface) | `0x3600000000000000000000000000000000000000` |
| GuardianVault (family demo) | _TBD_ |
| GuardianVault (honeypot) | _TBD_ |

## How Pause uses Arc

- Balances, limits and fees are all in USDC, and gas is paid in USDC, so the user only ever sees dollars.
- The vault holds Arc's native USDC through its ERC-20 interface (6 decimals).
- The relayer pays gas for guardian decisions, so the guardian never needs funds.

## QuickNode Streams configuration

- **Network:** Arc Testnet
- **Dataset:** Receipts
- **Filter:** `server/quicknode/filter.js`. It keeps only logs emitted by the two vault addresses and returns `{ logs }`, or nothing.
- **Destination:** Webhook → `https://<server>/webhook/quicknode`. Set the `x-qn-token` header to `QUICKNODE_TOKEN`.
- **Why:** guardian alerts must fire on every held payment, in order, without the server polling the chain. Set `LOCAL_WATCH=false` in production so the Stream is the only source.

## ElevenLabs usage

- **ElevenLabs Agents (Conversational AI):** the guardian answers an "incoming call" in the app. The agent receives dynamic variables (`owner_name`, `amount`, `recipient`, `reasons`, `minutes_left`), explains why the payment was held, and answers questions.
- The agent deliberately has **no tool that can approve or cancel**. Voice informs; only the signed tap decides. That's the deepfake defense.
- Demo: a cloned voice saying "approve it" is rejected, because the attempt carries no guardian signature (`/guardian` → "try approving with a cloned voice").

Suggested agent prompt: *"You are Pause, a calm safety assistant calling {{owner_name}}'s guardian. A payment of {{amount}} to {{recipient}} is on hold for {{minutes_left}} more minutes. Warning signs: {{reasons}}. Explain this plainly, suggest calling {{owner_name}} on a known number, and remind them that only the Stop or Approve buttons on their phone decide. Never claim you can approve or cancel."*

## What's next

- Circle passkey wallets for owner and guardian, so there are no keys at all
- Outbound phone calls (ElevenLabs + Twilio) when the guardian's app is closed
- Several guardians with an m-of-n threshold; guardians for businesses (finance teams paying invoices)

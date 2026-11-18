# Pause — what you need to get and set up

Everything runs locally without any of this. These steps are for the real Arc testnet deployment, the voice features, and QuickNode.

## Checklist

| # | Get this | Where | Goes into |
|---|---|---|---|
| 1 | 3 wallet keys: **relayer**, **owner** (Mom), **guardian** | Run `cast wallet new` three times (Foundry), or any wallet app | See step 1 |
| 2 | Testnet USDC for **relayer** and **owner** | https://faucet.circle.com → Arc Testnet. Fallback: Circle Developer Console faucet, or ask in the hackathon Telegram | Their wallets |
| 3 | ElevenLabs **API key** | Hackathon coupon: Discord https://discord.com/invite/VnBvbbcdEC → #coupon-codes → Start Redemption. Then elevenlabs.io → Profile → API Keys | `server/.env` → `ELEVENLABS_API_KEY` |
| 4 | ElevenLabs **agent ID** | elevenlabs.io → Agents → Create agent (step 4 below) | `server/.env` → `ELEVENLABS_AGENT_ID` |
| 5 | QuickNode account + Stream | QuickNode credits guide (ask in Telegram for the link) → quicknode.com → Streams | Step 5 |
| 6 | Hosting (optional but judges need a link) | Vercel for `web/`, Railway or Render for `server/` | Step 6 |

Never paste private keys into chat or commit them. `.env` files are git-ignored.

## 1. Wallet keys

```bash
cast wallet new   # run 3 times, save each address + private key somewhere safe
```

- **relayer**: pays gas for guardian decisions and runs the honeypot. Needs USDC.
- **owner (Mom)**: sends payments from the family vault. Needs USDC.
- **guardian**: only signs. Needs no funds.

## 2. Deploy to Arc testnet

Check the current RPC URL at https://docs.arc.io (Connect to Arc). Chain ID is `5042002`.

```bash
cd contracts
export ARC_RPC=<rpc url from docs>
export RELAYER_KEY=0x...        # relayer private key

# family vault
OWNER=<owner address> GUARDIAN=<guardian address> \
  forge script script/Deploy.s.sol --rpc-url $ARC_RPC --private-key $RELAYER_KEY --broadcast

# honeypot vault (relayer is both owner and guardian, nothing is ever instant)
OWNER=<relayer address> GUARDIAN=<relayer address> DAILY_LIMIT=0 \
  forge script script/Deploy.s.sol --rpc-url $ARC_RPC --private-key $RELAYER_KEY --broadcast
```

Then send some testnet USDC (USDC contract `0x3600000000000000000000000000000000000000`) to both vault addresses, and trust the demo contact (grandson) on the family vault: owner calls `requestTrust(<address>)`, guardian calls `approve(<id>)`, anyone calls `execute(<id>)`. Tell Claude the addresses and it will do this part.

## 3. Fill in the env files

`server/.env`

| Variable | Value |
|---|---|
| `RPC_URL` | Arc RPC URL |
| `CHAIN_ID` | `5042002` |
| `CHAIN_NAME` | `arc-testnet` |
| `EXPLORER_URL` | Arc testnet explorer base URL (from docs.arc.io) |
| `RELAYER_KEY` | relayer private key |
| `FAMILY_VAULT` / `HONEYPOT_VAULT` | addresses from step 2 |
| `DEMO_OWNER_KEY` / `DEMO_GUARDIAN_KEY` | owner and guardian private keys (used by the /console walkthrough) |
| `DEMO_TRUSTED` | grandson address |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | from steps 3–4 |
| `LOCAL_WATCH` | `true` until the QuickNode Stream works, then `false` |
| `QUICKNODE_TOKEN` | any random string; also set as a header on the Stream |

`web/.env.local`

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:8787` (or the hosted server URL) |
| `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_CHAIN_ID` | same as server |
| `NEXT_PUBLIC_OWNER_KEY` / `NEXT_PUBLIC_GUARDIAN_KEY` | owner and guardian keys (testnet demo only) |
| `NEXT_PUBLIC_CONTACTS` | `Grandson Leo:<grandson address>` |

## 4. ElevenLabs agent

1. elevenlabs.io → **Agents** → **Create agent** → blank.
2. **First message:** `Hi, this is Pause. {{owner_name}} is trying to send {{amount}} and I've put it on hold.`
3. **System prompt:** copy the suggested prompt from README → "ElevenLabs usage".
4. Pick a calm voice. Do **not** give it any tools (it must not be able to approve).
5. **Security** tab: enable authentication (so the server's signed URL is required).
6. Copy the **Agent ID** into `server/.env`.
7. Voice cloning (`/clone` page) needs a plan that includes Instant Voice Cloning. Check your plan after redeeming the coupon.

## 5. QuickNode Stream

1. quicknode.com → **Streams** → Create Stream.
2. Network **Arc Testnet**, dataset **Receipts**, start from latest block.
3. **Filter:** paste `server/quicknode/filter.js`, replacing the two placeholder addresses with your vault addresses in lowercase.
4. **Destination:** Webhook → `https://<hosted server>/webhook/quicknode`, add header `x-qn-token: <QUICKNODE_TOKEN>`.
   - Testing locally: expose the server with `npx localtunnel --port 8787` or ngrok and use that URL.
5. Start it, send a test payment, and watch the "Under the hood" terminal: lines tagged `stream` come from QuickNode.

## 6. Run

```bash
anvil                      # local only; skip on Arc
cd server && npm start
cd web && npm run dev      # http://localhost:3000
node server/scripts/e2e.js # optional check (set E2E_* keys for Arc)
```

## Still to do before Friday 12:00 PM CST

- [ ] Arc deploy + addresses in README
- [ ] ElevenLabs key + agent, test voice briefing and /clone
- [ ] QuickNode Stream configured
- [ ] Host web + server
- [ ] Public GitHub repo
- [ ] 2–3 min demo video (must show ElevenLabs with audio)
- [ ] Devpost form: track = Consumer, chain award = Arc, bounties = ElevenLabs + QuickNode
- [ ] Be there in person Saturday

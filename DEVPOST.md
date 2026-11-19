# Pause

**Tagline:** A USDC wallet that calls someone you trust before a scammer gets paid.

**Links**
- Live app: https://pause-six-theta.vercel.app
- Code: https://github.com/johnnyhliang/ubchackathon2026
- Family vault on Arc testnet: https://testnet.arcscan.app/address/0x1d623326c71F28AcA7E00C0274ae9d94913BD7B5
- Honeypot vault: https://testnet.arcscan.app/address/0xdADBF921beAd72C374107C473f5157FDD3E6afd1

---

## Inspiration

It's 11 p.m. and the phone rings. It's your grandson. You'd know that voice anywhere: the way he says "Grandma", the nervous laugh. He's been in a car accident, he's being held, and he needs $2,000 for bail right now. Please don't tell Mom. He'll send you an address.

It isn't him. It's a stranger who took 30 seconds of his voice from a video he posted and fed it to a voice-cloning tool. Every detail is right, because the scammer has one advantage over you: they never have to be calm, and you never get time to think.

That's the whole scam. It doesn't break any encryption. It breaks the five minutes between panic and a second opinion.

Banks learned to close that gap decades ago. When something looks off, they hold the payment and call you. Stablecoins skipped that part. A USDC payment settles in seconds and is final; there is nobody to call and nothing to hold. As stablecoins become ordinary money for ordinary people, the people most likely to get that 11 p.m. call are the ones with the least protection.

I didn't want to build a better deepfake detector. Detectors lose to better fakes. Instead I asked: what if it didn't matter how good the voice was?

**Pause** gives every payment that looks wrong ten minutes and one call to someone you trust. And the only thing that can approve it is that person's own phone, never a voice. Scammers can fake her voice. They can't fake her signature.

## What it does

Pause is a vault for USDC on Arc.

- **Everyday payments are instant.** Paying someone you've trusted before, under your daily limit, costs one transaction and no waiting.
- **Unusual payments are held.** A large amount, a new address, or any attempt to weaken the protection waits 10 minutes.
- **Your guardian gets a call.** A person you chose (a daughter, a friend) gets an alert. An ElevenLabs voice agent explains what's happening: how much, to whom, and why it looks risky. They can stop the payment or approve it early with one tap.
- **A cloned voice can't approve anything.** The tap produces an EIP-712 signature from the guardian's own device, and the contract checks it. A scammer who perfectly copies the guardian's voice still has no key, so their "approval" is rejected on-chain.
- **The guardian can't steal.** They can stop or approve, but there is no function that lets them move the money themselves.
- **Removing the protection is protected too.** Changing the guardian, raising the limit, or trusting a new address is held for the guardian, so a scammer can't talk you into switching it off first.
- **The guardian can't trap you either.** You can always move everything to your own recovery address after 7 days, and the guardian can't cancel it. A thief with your key can only send the money home.

There's also a public honeypot vault with about $300 in it. Anyone can try to drain it at `/steal`. The counter of attempts goes up; the amount stolen stays at $0.

## Try it

1. **`/wallet`**: send $1 to Grandson Leo (instant), then $5 to any new address (held).
2. **`/guardian`**: the held payment appears with its warning signs. Tap Answer to hear the voice briefing, try approving with a "cloned voice" and watch it fail, then tap Stop.
3. **`/clone`**: record 30 seconds of your own voice. ElevenLabs clones it, the clone says "approve the payment", and the vault rejects it. The clone is deleted afterwards.
4. **`/console`**: an eight-step walkthrough with a live terminal showing each layer react: the app call, the block, the QuickNode event, the risk score, the signature check, and the contract result. It includes the scam succeeding *without* Pause, and the case where nobody answers and the payment goes through.
5. **`/steal`**: try to rob the honeypot.

## How I built it

- **Contract (Solidity, Foundry):** `GuardianVault` holds Arc's native USDC through its ERC-20 interface. Owner actions are either instant or queued with a delay. The guardian decides directly or by a relayed EIP-712 signature (`decideBySig`), verified with OpenZeppelin's `SignatureChecker`, so the guardian can also be a smart-contract wallet such as a passkey account. 19 tests, including an escape hatch: the owner can always move everything to a fixed recovery address after 7 days, and the guardian cannot cancel it, so a hostile guardian can slow you down but never trap your money.
- **Arc:** everything is in dollars. Balances, limits and gas are all USDC, so a non-crypto user never sees another token. A relayer pays gas for guardian decisions, so the guardian needs no funds at all.
- **QuickNode Streams:** a Stream on Arc testnet receipts, filtered to the vaults' logs, pushes every held payment to the server by webhook. Alerts fire in order without the server polling the chain.
- **ElevenLabs:** an Agents voice assistant briefs the guardian, using the payment details as dynamic variables. It deliberately has no tool that can approve or cancel; the voice informs, only the signed tap decides. The `/clone` demo uses Instant Voice Cloning and text-to-speech to attack the vault with a real copy of a volunteer's voice.
- **Server (Node, Express, viem):** event intake, risk scoring (new address, size against the limit, time of day), signature relay, and a live event stream to the browser.
- **App (Next.js, Tailwind):** the wallet, the guardian's phone view, the walkthrough console and the honeypot. Deployed on Vercel, with the server on Railway.

## Challenges

- **Making "the guardian can't steal" true, not just claimed.** Every guardian power had to be a yes/no on something the owner already asked for. Finding the bypasses (raise the limit first, then pay; swap the guardian first, then pay) and holding those too took a few rounds.
- **A voice agent that can't be talked into anything.** The easy design gives the agent an "approve" tool. That would make the voice the weak point again, so the agent only explains.
- **Testnet realities.** Arc's RPC can be slow to return new events, so the end-to-end test retries. And because USDC is the gas token on Arc, every demo wallet needs a little USDC just to send a transaction.

## Accomplishments

- A real cloned voice, made live from a volunteer, fails to move money, and the console shows exactly why: the recovered signer isn't the guardian.
- The whole flow runs on Arc testnet with real USDC transfers, not mocks.
- The demo is honest about the limits: it shows the scam working without Pause, and shows the payment going through when nobody answers.

## What I learned

Security that asks a person to judge a voice will keep losing to better voices. Moving the decision to a signature, and using voice only to explain, makes the deepfake problem go away instead of making it harder.

## What's next

- Circle passkey wallets for the owner and the guardian, so there are no seed phrases or keys at all.
- Real phone calls (ElevenLabs and Twilio) when the guardian's app is closed.
- Several guardians with a 2-of-3 rule, and the same pattern for small businesses paying invoices.

## Built with

Solidity · Foundry · OpenZeppelin · Arc · USDC · QuickNode Streams · ElevenLabs Agents · ElevenLabs Voice Cloning · Node.js · Express · viem · Next.js · Tailwind CSS · Vercel · Railway

## Prize categories

Consumer Applications track · Best use of Arc · ElevenLabs · QuickNode

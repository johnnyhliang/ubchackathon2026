# UBC 2026 Hackathon — idea comparison

Deadline: Fri Nov 20, 12:00 PM CST. Judging in person Sat Nov 21 (must attend to win anything).
Builder: solo. Chosen idea: **Guardian wallet** (see bottom).

## Ideas considered

| Idea | Prizes it can enter | Demo moment | Buildable by Fri (solo) | Already exists? |
|---|---|---|---|---|
| **Guardian wallet** — large/unusual USDC payments are held; a trusted person approves with a signed tap; cloned voices can't approve | Consumer, Arc, ElevenLabs, QuickNode | A cloned voice says "approve it" and the contract rejects it | Yes | Coinbase Transfer Protections, Casa Guardian Mode, SwissBorg time-lock — all inside their own platforms. No onchain or deepfake-proof version found |
| Called It — AI call-in show on prediction-market odds, timestamped calls onchain | Consumer, Gemini, ElevenLabs | Fun, no surprise | Yes, easiest | Not found |
| x402 firewall with refunds | Agentic, Arc | Dull | Yes | Partly (wallet vendors' limits) |
| Gig tips via QR, cash out to card | Consumer, Arc | Phone buzzes | Yes (cash-out mocked) | Many tip apps |
| Split-the-bill pools, voice agent pays | Consumer, Arc, ElevenLabs | Good | Yes | Close to C.E.S.T.A (won Arc at ETHGlobal Cannes) |
| Pay-per-question research agent with voice budget | Agentic, Arc, ElevenLabs | Medium | Yes | Crowded (default Arc entry at Cannes) |
| ZK "prove you're over 21" | Consumer | Strong concept, hard to show | Risky | zkPassport, Self |
| Face-value-only concert tickets | Consumer, Arc | Above-face resale rejected | Yes | Tried often (GET Protocol, YellowHeart) |
| Forecast Bazaar, novel-underlying perps, odds-oracle vault, setlist voting | — | — | — | Dropped: reads as trading bot / too big / weak video |

## Why the guardian wallet

- 2026 is a record hack year; most losses come from keys and social engineering, not contract bugs.
- Circle has been criticised for slow USDC freezes (Drift, April 2026) — an Arc judge will know the story.
- Past winners skew toward security (Unrugable, ENShell, suspETHious) and concrete human stories.
- Gap vs Coinbase etc.: works onchain from any wallet, and approval is a cryptographic signature, so a deepfaked voice is useless.

Pitch line: *"Scammers can fake your daughter's voice. They can't fake her phone."*

## Answers to expected judge questions

- **"Isn't this a timelock?"** The owner can't switch protection off: raising limits, trusting new addresses and changing the guardian are themselves held and cancellable by the guardian.
- **"Coinbase already does this."** Only for money held at Coinbase. This is a contract any wallet/app can use.
- **Limits:** an attacker draining in amounts under the instant limit to already-trusted recipients still gets through; a guardian who ignores alerts lets held payments execute after the delay.

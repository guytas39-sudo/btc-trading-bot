# Tidepool — a cbBTC trading bot

An entry for the make.fun bounty "Race a BTC trading bot live for 24 hours": a bot that trades Coinbase Wrapped BTC (cbBTC) against USDC minute by minute on 1-minute on-chain prices, starting with $1,000 of paper money. Simulation only — nothing is traded for real.

## Strategy

Two simple, independent edges share the single long-only position slot, and the bot otherwise sits in cash:

- **Trend leg — 60-bar Donchian breakout.** Buy when the close breaks above the highest high of the previous 60 one-minute bars; sell when it breaks below the lowest low of the previous 60. Breakouts ride the big hourly moves, while the slow 60-bar exit keeps the bot out of the 1-minute whipsaw that eats fast crossover systems alive.
- **Dip leg — hourly mean reversion.** Buy when the last 60 minutes fell more than 100 bps; sell when the price recovers 60 bps from the entry close, or falls a further 50 bps (hard stop). One-minute BTC mean-reverts at the hourly scale, so sharp hourly drops tend to bounce — but only a little, hence the tight take-profit.

Everything is sized at 100% of cash: with ~26 bps round-trip cost (4 bps fee + 2 bps slippage + ~17 bps pool impact at full size), a trade has to catch a real move, so the bot trades rarely — 12 fills on the 24-hour dev window — and otherwise holds cash. No shorts, no leverage, no randomness, no wall clock: every decision is a pure function of the bars seen so far, so two runs on the same data produce byte-identical action logs. All prices are kept as raw integers (BigInt); the only division is the basis-point return, done in integers.

## Dev-window result (local grade, `grade-local --driver process`)

Net PnL **+$26.97** on the frozen 24-hour dev window (12 trades, max drawdown 2.01%) — comfortably above the $0 dev gate. Buy-and-hold makes +$33.95 on the same window but rides every drawdown with no exit; Tidepool gives up some of the early uptrend to keep its downside capped.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — the kit's bars-replay protocol shim, copied byte-for-byte

[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/guytas39-sudo/btc-trading-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/guytas39-sudo/btc-trading-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

Built for [make.fun](https://make.fun/?ref=g2zdh0s8)

// Tidepool — a two-leg cbBTC/USDC trading bot for agent-fun/bars-replay/v1.
//
// Two independent, deliberately simple edges share the single long-only position slot:
//
//   TREND leg — 60-bar Donchian breakout: buy when the close breaks above the highest
//   high of the previous 60 one-minute bars, sell when it breaks below the lowest low
//   of the previous 60. Breakouts ride the big hourly moves; the slow 60-bar exit
//   keeps the bot out of the 1-minute whipsaw that eats fast crossover systems alive.
//
//   DIP leg — hourly mean reversion: buy when the last 60 minutes fell more than 100
//   bps, sell when the price recovers 60 bps from the entry close, or falls a further
//   50 bps (hard stop). One-minute BTC mean-reverts at the hourly scale, so sharp
//   hourly drops tend to bounce — but only a little, hence the tight take-profit.
//
// Everything is sized at 100% of cash: with ~26 bps round-trip cost (4 bps fee +
// 2 bps slippage + ~17 bps pool impact at full size on this pool's depth), a trade
// has to catch a real move, so the bot trades rarely (12 fills on the 24 h dev
// window) and otherwise sits in cash. No shorts, no leverage, no randomness, no
// wall clock, no environment reads: every decision is a pure function of the bars
// seen so far, so two runs on the same data produce byte-identical action logs.
// A minute with no bar for the symbol is skipped, never counted twice, so the
// 60-bar window always spans 60 real minutes even on a window with gaps.
//
// All prices are kept as raw integers (BigInt) at the symbol's scales; the only
// division is the basis-point return, done in integers.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 60; // bars for the Donchian channel and the hourly return
const DIP_DROP_BPS = -100; // buy the dip when the last hour fell this far
const DIP_TAKE_BPS = 60; // sell the dip when it recovered this far from entry
const DIP_STOP_BPS = -50; // sell the dip when it fell this much further
const MAX_SLIPPAGE_BPS = 100; // fills move ~20 bps gap + ~6 bps slip + ~17 bps impact
const SCORED_BARS = 1440; // one full window; never order on its last bar

interface BarMark {
  h: bigint;
  l: bigint;
  c: bigint;
}

type Mode = 'flat' | 'trend' | 'dip';

const history: BarMark[] = [];
let mode: Mode = 'flat';
let entryClose = 0n;
let scoredSeen = 0;

function bpsReturn(now: bigint, then: bigint): bigint {
  return ((now - then) * 10000n) / then;
}

function donchian(): { hi: bigint; lo: bigint } | null {
  // Previous LOOKBACK bars, excluding the current one: history[..-1].
  if (history.length < LOOKBACK + 1) return null;
  let hi = 0n;
  let lo: bigint | null = null;
  for (let i = history.length - LOOKBACK - 1; i < history.length - 1; i++) {
    const b = history[i]!;
    if (b.h > hi) hi = b.h;
    if (lo === null || b.l < lo) lo = b.l;
  }
  return { hi, lo: lo! };
}

function decide(state: BarsState, batch: Batch): OrderInput[] {
  // Use only a bar this batch actually carries. The replay may skip a minute
  // (up to 28 of a window's 1,440 may be missing); state.latest would hand back
  // the previous bar again, and appending it would count one minute twice, so
  // the 60-bar window would span fewer than 60 real minutes. A gap minute
  // carries no new information, so the bot simply waits it out.
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];
  history.push({ h: BigInt(bar.h), l: BigInt(bar.l), c: BigInt(bar.c) });

  // Warm-up batches build history only; the harness rejects orders on them anyway.
  if (state.warmingUp) return [];
  scoredSeen += 1;
  // An order decided on the window's last bar is rejected (after_end); skip it.
  if (scoredSeen >= SCORED_BARS) return [];

  const qty = state.positions.get(SYMBOL)?.qty ?? 0n;
  if (qty === 0n) mode = 'flat'; // a rejected buy or a completed sell resets the leg
  const close = BigInt(bar.c);
  const channel = donchian();
  if (channel === null) return [];

  if (qty === 0n) {
    // TREND leg: breakout above the 60-bar high.
    if (close > channel.hi) {
      mode = 'trend';
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // DIP leg: the last hour dropped hard; buy the bounce.
    const hourAgo = history[history.length - LOOKBACK - 1]!.c;
    if (bpsReturn(close, hourAgo) <= BigInt(DIP_DROP_BPS)) {
      mode = 'dip';
      entryClose = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Holding a position: exit by whichever leg opened it.
  if (mode === 'trend') {
    if (close < channel.lo) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }
  // Dip leg: tight take-profit, tighter stop.
  const r = bpsReturn(close, entryClose);
  if (r >= BigInt(DIP_TAKE_BPS) || r <= BigInt(DIP_STOP_BPS)) {
    return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    return decide(state, batch);
  },
});

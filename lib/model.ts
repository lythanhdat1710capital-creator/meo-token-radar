// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks the protocols that record no token and are real launch candidates: every slug on
// the snapshot's watchlist, plus every other pre-token protocol below the floor that is not a
// wrapped, staked or bridged product of a token that already trades. A protocol is pre-token when
// its record carries no market cap, no CoinGecko id and no symbol; the snapshot's live-token
// protocols are kept apart and shown at the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple   = the category's market-cap-per-TVL, learned from the snapshot's live tokens:
//                each live protocol's mcap_usd / tvl_usd, winsorized at 2.0, the median per
//                category, shrunk toward the market-wide median with a prior of 8, clamped to
//                [0.05, 1.0]. A category with few live tokens counts less; one with none takes
//                the market-wide median. No protocol name is ever special-cased.
//   growth     = clamp(change_7d, -50, 100) per cent; unknown growth counts as 0.
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.6 + 0.4 x min(age, 730) / 730 for age up to two years, then easing to 0.8
//                by five years: longevity proves staying power, but five silent years suggest
//                the team may never issue a token. Unknown age counts as 365 days.
//   chainsMult = 1 + 0.02 x min(chains - 1, 10): wider distribution, wider holder base.
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturityMult x chainsMult))
//
// The same function scores every row, and the dashboard states the model and prints the multiples
// table it learned, so a reader can check the ranking instead of trusting it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  winsorize_ratio: number;
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_peak_days: number;
  maturity_tail_days: number;
  maturity_tail_floor: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  winsorize_ratio: 2.0,
  shrink_prior: 8,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_peak_days: 730,
  maturity_tail_days: 1095,
  maturity_tail_floor: 0.8,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_per_tvl: number | null;
}

/** A protocol set aside from the ranked board, with the reason it is not a launch candidate. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** One row of the multiples table the model learned from the live set. */
export interface MultipleRow {
  category: string;
  live_count: number;
  median_ratio: number | null;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the set-aside list, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  global_median_ratio: number;
  multiples: MultipleRow[];
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the house's watchlist rule treats as wrapped, staked or bridged products. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Why a protocol is set aside, in the dashboard's words. */
export function setAsideReason(p: SnapshotProtocol): string {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) {
    return `Category ${p.category}: a wrapped, staked or bridged product of a token that already trades, not a launch of its own.`;
  }
  if (WRAPPED_WORD.test(p.name)) return 'Its name marks it as a wrapped or staked product of a token that already trades.';
  if (EXCHANGE_PREFIX.test(p.name)) return 'Its name marks it as an exchange product, not a protocol waiting on a launch.';
  if (VERSIONED.test(p.name)) return 'Its name ends in a version marker: a pool of another protocol, not a launch of its own.';
  return 'Not a launch candidate under the snapshot\u2019s own rules.';
}

/** Whether a protocol is one the board may rank: pre-token, not versioned, not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !isWrappedProduct(p);
}

/**
 * The category multiples the model learns from the snapshot's live tokens: each live protocol's
 * market-cap-per-TVL, winsorized, the median per category, shrunk toward the market-wide median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, number>; table: MultipleRow[] } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const ratio = (p: SnapshotProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, model.winsorize_ratio);
  const global = median(live.map(ratio)) ?? 0.17;
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorized';
    const list = byCat.get(key) ?? [];
    list.push(ratio(p));
    byCat.set(key, list);
  }
  const byCategory = new Map<string, number>();
  const table: MultipleRow[] = [];
  for (const [category, ratios] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
    const med = median(ratios);
    const multiple = Math.min(
      model.multiple_cap,
      Math.max(model.multiple_floor, ((med ?? global) * ratios.length + global * model.shrink_prior) / (ratios.length + model.shrink_prior)),
    );
    byCategory.set(category, multiple);
    table.push({ category, live_count: ratios.length, median_ratio: med === null ? null : round4(med), multiple: round4(multiple) });
  }
  return { global: round4(global), byCategory, table };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult: number;
  if (ageForModel <= model.maturity_peak_days) {
    maturityMult = model.maturity_floor + (1 - model.maturity_floor) * (ageForModel / model.maturity_peak_days);
  } else {
    const past = Math.min(ageForModel - model.maturity_peak_days, model.maturity_tail_days);
    maturityMult = 1 - (1 - model.maturity_tail_floor) * (past / model.maturity_tail_days);
  }
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category family's three tailored moves: the main action, the weekly action, what to track. */
interface Playbook {
  main: string;
  weekly: string;
  track: string;
}

/** The playbook, keyed by what the protocol's category says it does. No name is ever special-cased. */
function playbookFor(p: SnapshotProtocol, capital: number, chain: string): Playbook {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it and repay it the same week so both sides of the book are active.`,
      weekly: `Top up the supply or make one small borrow and repayment, so the address shows lending activity every week.`,
      track: `Watch the supply APY and the borrow health factor on ${name}'s own page, and keep the health factor above 2.`,
    };
  }
  if (c.includes('dex') || c.includes('amm')) {
    return {
      main: `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position in range.`,
      weekly: `Make one swap through ${name} and collect the pool fees, so the address shows trading as well as liquidity.`,
      track: `Watch the pool's fee earnings and your range on ${name}'s own page, and rebalance if the price leaves the range.`,
    };
  }
  if (c.includes('yield') || c.includes('leveraged farm')) {
    return {
      main: `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the vault shares.`,
      weekly: `Harvest the vault's yield once and redeposit it, so the address compounds instead of sitting idle.`,
      track: `Watch the vault's APY and its strategy on ${name}'s own page, and leave if the APY falls below the chain's base rate.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return {
      main: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`,
      weekly: `Close the position and open one fresh small trade, so the address shows repeated trading activity.`,
      track: `Watch the funding rate and your margin ratio on ${name}'s own page, and close the trade if funding turns against you.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund $${capital} on ${name} on ${chain} and take one position in a market that resolves within the month.`,
      weekly: `Take one new market position and settle the ones that resolved, so the address shows repeated market activity.`,
      track: `Watch the markets you hold on ${name}'s own page, and never hold a position past its resolution date.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      main: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farm wallet.`,
      weekly: `Check the vault's allocation and add one small deposit, so the address shows a growing position.`,
      track: `Watch the curator's allocation and the vault's net value on ${name}'s own page, and move vaults if the curator changes strategy.`,
    };
  }
  if (c.includes('stable')) {
    return {
      main: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farm wallet.`,
      weekly: `Redeem a small amount and mint it back, so the address shows both sides of the stablecoin's flow.`,
      track: `Watch the peg and the redemption rate on ${name}'s own page, and redeem fully if the peg slips below $0.99.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      main: `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`,
      weekly: `Check the accrued yield and add one small mint, so the position grows instead of sitting idle.`,
      track: `Watch the underlying asset report and the yield rate on ${name}'s own page, and read the latest attestation before adding funds.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active in the farm wallet.`,
      weekly: `Check the policy's status and the protocol's claims queue, so the address stays linked to the cover.`,
      track: `Watch the cover's expiry and the claims queue on ${name}'s own page, and renew the cover before it lapses.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      main: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      weekly: `Restake the staking rewards and use the receipt token once in the protocol's own app.`,
      track: `Watch the receipt token's exchange rate on ${name}'s own page, and unstake if the rate slips against the underlying.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      weekly: `Bridge a small amount back and forth, so the address shows repeated bridging in both directions.`,
      track: `Watch the bridge's fee and the arrival time on ${name}'s own page, and keep the receipt until the funds land.`,
    };
  }
  if (c.includes('payment')) {
    return {
      main: `Route $${capital} through ${name} on ${chain} for one real payment and keep the receipt.`,
      weekly: `Route one more payment through ${name}, so the address shows repeated use of the rails.`,
      track: `Watch the settlement time and the fee on ${name}'s own page, and stop if a payment takes longer than a day.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      main: `Stake $${capital} with ${name} on ${chain} to qualify for its next token sale allocation.`,
      weekly: `Check the upcoming sales and confirm the allocation, so the address is ready when a sale opens.`,
      track: `Watch the sale calendar and your allocation tier on ${name}'s own page, and unstake only after the sale closes.`,
    };
  }
  if (c.includes('chain')) {
    return {
      main: `Use $${capital} in ${name}'s flagship app on ${chain} and keep the position open.`,
      weekly: `Make one transaction in the chain's apps through ${name}, so the address shows repeated on-chain activity.`,
      track: `Watch the chain's activity and the app's own page, and keep enough gas on ${chain} for the next transaction.`,
    };
  }
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} and use the app's main feature once.`,
    weekly: `Use ${name}'s main feature once a week, so the address shows repeated activity rather than a single deposit.`,
    track: `Watch ${name}'s own points or rewards page weekly, and note which actions it counts before you repeat them.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: book.main,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: book.weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: book.track,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Before you claim anything, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and keep enough gas on ${chain} to unwind the position.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: MultipleRow[]; globalMedian: number } {
  const { global, byCategory, table } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any size. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const multiple = byCategory.get(p.category ?? 'Uncategorized') ?? global;
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, implied, multiple, growthPct, growthMult, maturityMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, multiples: table, globalMedian: global };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_per_tvl: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** The protocols set aside from the ranked board, largest first, each with its reason. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && (isWrappedProduct(p) || VERSIONED.test(p.name)))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p),
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples, globalMedian } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    global_median_ratio: globalMedian,
    multiples,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      on_watchlist: watchlist.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

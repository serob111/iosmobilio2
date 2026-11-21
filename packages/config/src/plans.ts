/**
 * The one place plan prices and feature lists live. Both the landing page's pricing
 * teaser and the full /pricing page render off this — never hardcode a price or a
 * feature list in a component.
 */
export type PlanId = 'preview' | 'testOnIphone' | 'launch' | 'growth' | 'agency';

export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanPrice {
  /** USD, whole dollars. `null` for plans priced per request (none today) or already covered by `once`. */
  monthly: number | null;
  yearly: number | null;
  /** Set only for one-time plans (Preview is free, Test on iPhone is a single $29 charge). */
  once: number | null;
}

export interface Plan {
  id: PlanId;
  price: PlanPrice;
  mostPopular?: boolean;
  /** How many published apps this plan allows — drives the Projects page's plan banner once Paddle billing exists. */
  publishedAppLimit: number;
}

export const PLANS: Record<PlanId, Plan> = {
  preview: {
    id: 'preview',
    price: { monthly: 0, yearly: 0, once: null },
    publishedAppLimit: 0,
  },
  testOnIphone: {
    id: 'testOnIphone',
    price: { monthly: null, yearly: null, once: 29 },
    publishedAppLimit: 0,
  },
  launch: {
    id: 'launch',
    price: { monthly: 49, yearly: 39, once: null },
    mostPopular: true,
    publishedAppLimit: 1,
  },
  growth: {
    id: 'growth',
    price: { monthly: 99, yearly: 79, once: null },
    publishedAppLimit: 3,
  },
  agency: {
    id: 'agency',
    price: { monthly: 299, yearly: 239, once: null },
    publishedAppLimit: 10,
  },
};

/** Done-for-you App Store publishing add-on — a flat one-time fee on top of any paid plan. */
export const DONE_FOR_YOU_PUBLISHING_PRICE_USD = 299;

/** Apple's own yearly fee for the Apple Developer Program — not Mobilio's price, just quoted alongside it. */
export const APPLE_DEVELOPER_PROGRAM_PRICE_USD = 99;

export function planPriceForPeriod(plan: Plan, period: BillingPeriod): number | null {
  if (plan.price.once !== null) return plan.price.once;
  return period === 'yearly' ? plan.price.yearly : plan.price.monthly;
}

export const PLAN_ORDER: PlanId[] = ['preview', 'testOnIphone', 'launch', 'growth', 'agency'];

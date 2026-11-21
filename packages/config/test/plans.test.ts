import { describe, expect, it } from 'vitest';
import { PLANS, PLAN_ORDER, planPriceForPeriod } from '../src';

describe('planPriceForPeriod', () => {
  it('returns the one-time price regardless of period for one-time plans', () => {
    expect(planPriceForPeriod(PLANS.testOnIphone, 'monthly')).toBe(29);
    expect(planPriceForPeriod(PLANS.testOnIphone, 'yearly')).toBe(29);
  });

  it('returns the recurring price matching the requested period', () => {
    expect(planPriceForPeriod(PLANS.launch, 'monthly')).toBe(49);
    expect(planPriceForPeriod(PLANS.launch, 'yearly')).toBe(39);
  });

  it('free preview plan is 0 either way', () => {
    expect(planPriceForPeriod(PLANS.preview, 'monthly')).toBe(0);
    expect(planPriceForPeriod(PLANS.preview, 'yearly')).toBe(0);
  });
});

describe('PLAN_ORDER', () => {
  it('lists every plan defined in PLANS, in display order, with no duplicates', () => {
    expect(new Set(PLAN_ORDER)).toEqual(new Set(Object.keys(PLANS)));
    expect(PLAN_ORDER).toHaveLength(Object.keys(PLANS).length);
  });

  it('marks exactly one plan as most popular', () => {
    const popular = PLAN_ORDER.filter((id) => PLANS[id].mostPopular);
    expect(popular).toEqual(['launch']);
  });
});

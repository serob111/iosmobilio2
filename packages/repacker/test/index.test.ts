import { describe, expect, it } from 'vitest';
import { REPACKER_PLACEHOLDER } from '../src/index';

describe('@mobilio/repacker placeholder', () => {
  it('exists and loads without error', () => {
    expect(REPACKER_PLACEHOLDER).toBe(true);
  });
});

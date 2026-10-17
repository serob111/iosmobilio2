import { describe, expect, it } from 'vitest';
import { processPingJob } from '../src/processors';

describe('processPingJob', () => {
  it('returns pong: true and echoes the requestId', () => {
    expect(processPingJob({ requestId: 'req-123' })).toEqual({ pong: true, requestId: 'req-123' });
  });

  it('returns pong: true with an undefined requestId when none is given', () => {
    expect(processPingJob({})).toEqual({ pong: true, requestId: undefined });
  });
});

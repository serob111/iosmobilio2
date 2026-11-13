import { describe, expect, it } from 'vitest';
import { createObjectStorageFromEnv } from '../src/object-storage';

const FULL_ENV = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'mobilio',
  S3_ACCESS_KEY_ID: 'mobilio',
  S3_SECRET_ACCESS_KEY: 'mobilio_minio_pw',
};

describe('createObjectStorageFromEnv', () => {
  it('constructs an ObjectStorage when every required var is set', () => {
    expect(() => createObjectStorageFromEnv(FULL_ENV)).not.toThrow();
  });

  it.each(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])(
    'throws when %s is missing',
    (missingVar) => {
      const env = { ...FULL_ENV, [missingVar]: undefined };
      expect(() => createObjectStorageFromEnv(env)).toThrow(
        'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must all be set',
      );
    },
  );
});

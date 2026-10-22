import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Local/CI only: real R2 buckets are provisioned out-of-band in prod, but MinIO starts
 * with none, and there's no reliable `mc`/aws-cli container image left on Docker Hub to
 * create one with (MinIO Inc. and Bitnami both locked their client images behind auth in
 * 2025). Plain @aws-sdk/client-s3, already a dependency here, does the same job.
 */
async function main(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must all be set');
  }

  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists`);
    return;
  } catch {
    // Falls through to create — HeadBucket throws for both "doesn't exist" and other
    // transient errors, so CreateBucket (idempotent below) is the real source of truth.
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket "${bucket}"`);
  } catch (error) {
    const code = (error as { Code?: string; name?: string }).Code ?? (error as { name?: string }).name;
    if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
      console.log(`Bucket "${bucket}" already exists`);
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

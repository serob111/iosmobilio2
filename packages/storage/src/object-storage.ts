import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  /** Multipart-uploads a stream — for files too large to buffer whole in memory (e.g. .ipa builds). */
  putStream(key: string, body: Readable, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * A time-limited GET url — the only way objects are ever downloaded (no public bucket
   * access). `filename`, if given, sets Content-Disposition so a browser download keeps
   * a meaningful name (object keys are internal paths like orgs/<id>/.../app.ipa, not
   * what a user should see save to their Downloads folder as).
   */
  signedUrl(key: string, expiresInSeconds: number, filename?: string): Promise<string>;
}

export type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // MinIO (local/CI) needs path-style URLs (http://host/bucket/key); R2 and most real S3
  // endpoints accept either, but path-style is the common denominator.
  forcePathStyle?: boolean;
  /**
   * The host a signed URL's hostname should point at, if different from `endpoint`.
   * Inside docker-compose, api/worker reach MinIO at the internal `http://minio:9000` —
   * fine for put/get/delete, which happen server-to-server, but a signed URL is handed
   * to a browser, which can't resolve that hostname. Defaults to `endpoint` (correct for
   * R2 in prod, where the same endpoint is reachable from both sides).
   */
  publicEndpoint?: string;
};

function contentDisposition(filename: string): string {
  // Strips CR/LF (header injection) and quotes (would break out of the quoted-string)
  // from the ASCII fallback; the filename*= extended form carries the exact name,
  // including any non-ASCII characters, per RFC 6266/5987.
  const safeAscii = filename.replace(/[\r\n"]/g, '_');
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  // A separate client, pointed at publicEndpoint, exists solely so presigned URLs carry
  // a host a browser can actually reach — getSignedUrl bakes the client's configured
  // endpoint into the URL it returns, so the "real" internal client can't be reused here.
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    const forcePathStyle = config.forcePathStyle ?? true;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle,
      credentials,
    });
    this.presignClient = new S3Client({
      endpoint: config.publicEndpoint ?? config.endpoint,
      region: config.region,
      forcePathStyle,
      credentials,
    });
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async putStream(key: string, body: Readable, contentType?: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    });
    await upload.done();
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) {
      throw new Error(`Object has no body: ${key}`);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds: number, filename?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: filename ? contentDisposition(filename) : undefined,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }
}

export function createObjectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must all be set');
  }
  return new S3ObjectStorage({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.S3_REGION ?? 'auto',
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? endpoint,
  });
}

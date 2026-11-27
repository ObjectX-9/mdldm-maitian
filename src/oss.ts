import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

type UploadOptions = { headers: Record<string, string>; mime: string; meta?: Record<string, string>; partSize?: number };
type OssClient = {
  put(key: string, file: string | Buffer, options: UploadOptions): Promise<unknown>;
  multipartUpload(key: string, file: string, options: UploadOptions): Promise<unknown>;
  head(key: string): Promise<{ res: { headers: Record<string, string> }; meta?: Record<string, string> }>;
  delete(key: string): Promise<unknown>;
  signatureUrlV4(method: 'GET', expires: number, request: object, key: string): Promise<string>;
};
const require = createRequire(import.meta.url);
let client: OssClient | undefined;
const prefix = 'fat-studio/';

export function ossClient(): OssClient | undefined {
  const { OSS_REGION: region, OSS_BUCKET: bucket, OSS_ACCESS_KEY_ID: accessKeyId, OSS_ACCESS_KEY_SECRET: accessKeySecret } = process.env;
  if (!region && !bucket && !accessKeyId && !accessKeySecret) return;
  if (!region || !bucket || !accessKeyId || !accessKeySecret) throw new Error('OSS 配置不完整');
  if (!client) {
    const OSS = require('ali-oss') as new (options: object) => OssClient;
    const proxy = process.env.MAITIAN_OSS_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
    const httpsAgent = proxy ? new (require('https-proxy-agent'))(proxy) : undefined;
    client = new OSS({ region, bucket, accessKeyId, accessKeySecret, secure: true, authorizationV4: true, timeout: 120_000, httpsAgent });
  }
  return client;
}

export async function uploadPrivateFile(oss: OssClient, key: string, filename: string, mime: string, bytes: number, sha256?: string) {
  const options: UploadOptions = { headers: { 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true' }, mime };
  if (sha256) options.meta = { sha256 };
  try {
    if (bytes >= 5 * 1024 * 1024) await oss.multipartUpload(key, filename, { ...options, partSize: 2 * 1024 * 1024 });
    else await oss.put(key, filename, options);
  } catch (error) {
    if ((error as { status?: number }).status === 409) throw error;
    throw Object.assign(new Error('附件上传到 OSS 失败', { cause: error }), { status: 502 });
  }
}

export async function storeResearchAsset(oss: OssClient, filename: string, mime: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const { size: bytes } = await stat(filename);
  const extension = path.extname(filename).toLowerCase();
  const objectKey = `${prefix}assets/${sha256}${extension}`;
  try { await uploadPrivateFile(oss, objectKey, filename, mime, bytes, sha256); }
  catch (error) {
    if ((error as { status?: number }).status !== 409) throw error;
    const head = await oss.head(objectKey);
    if (Number(head.res.headers['content-length']) !== bytes || (head.meta?.sha256 ?? head.res.headers['x-oss-meta-sha256']) !== sha256) throw error;
  }
  return { objectKey, bytes, sha256 };
}

export function creationObjectKey(id: string, index: number, extension: string) {
  return `${prefix}creations/${id}/${index}${extension}`;
}

export function creationUploadKey(filename: string) {
  return `${prefix}creations/uploads/${filename}`;
}

export function signedMediaUrl(oss: OssClient, key: string, disposition?: string) {
  if (!key.startsWith(prefix)) throw new Error('媒体路径超出工作室目录');
  return oss.signatureUrlV4('GET', 900, disposition ? { queries: { 'response-content-disposition': disposition } } : {}, key);
}

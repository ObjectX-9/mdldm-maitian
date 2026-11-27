import type { Db, MongoClient } from 'mongodb';

const runtime = globalThis as typeof globalThis & { maitianMongoConnection?: Promise<MongoClient> };

export async function mongoDb(): Promise<Db | undefined> {
  const uri = process.env.MAITIAN_MONGODB_URI;
  if (!uri) return;
  runtime.maitianMongoConnection ??= import('mongodb').then(async ({ MongoClient }) => {
    const hasCompressionOptions = /[?&](?:compressors|zlibCompressionLevel)=/i.test(uri);
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      compressors: hasCompressionOptions ? undefined : ['zlib'],
      zlibCompressionLevel: hasCompressionOptions ? undefined : 1,
    });
    try { return await client.connect(); }
    catch (error) { await client.close(); throw error; }
  }).catch(error => { runtime.maitianMongoConnection = undefined; throw error; });
  return (await runtime.maitianMongoConnection).db(process.env.MAITIAN_MONGODB_DATABASE || 'maitian');
}

export async function closeMongo() {
  const connection = runtime.maitianMongoConnection;
  runtime.maitianMongoConnection = undefined;
  if (connection) await (await connection).close();
}

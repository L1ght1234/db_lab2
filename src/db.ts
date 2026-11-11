import pg from 'pg';
import { MongoClient, type Db } from 'mongodb';
import { Redis } from 'ioredis';

const { Pool } = pg;

export const CONFIG = {
  pgUrl:
    process.env.PG_URL ??
    'postgres://postgres:postgres_password@localhost:5433/sports_nosql_lab2',
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'sports_nosql_lab2',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

export const pgPool = new Pool({
  connectionString: CONFIG.pgUrl,
  max: 30,
});

let mongoClient: MongoClient | null = null;

export async function connectMongo(): Promise<{ client: MongoClient; db: Db }> {
  if (!mongoClient) {
    mongoClient = new MongoClient(CONFIG.mongoUrl, { maxPoolSize: 30 });
    await mongoClient.connect();
  }
  return { client: mongoClient, db: mongoClient.db(CONFIG.mongoDb) };
}

export async function closeMongo(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
  }
}

export function createRedisClient(): Redis {
  return new Redis(CONFIG.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

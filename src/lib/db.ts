import mongoose from 'mongoose';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env in dev / seed context where process.env may not have Astro's vars
if (!process.env.MONGODB_URI) {
  dotenvConfig({ path: resolve(process.cwd(), '.env') });
}

const uri: string = process.env.MONGODB_URI ?? (import.meta.env?.MONGODB_URI as string) ?? '';

let cached: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } =
  (global as any).__mongooseCache;

if (!cached) {
  cached = (global as any).__mongooseCache = { conn: null, promise: null };
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      dbName: 'mareno',
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

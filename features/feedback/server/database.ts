import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client/web";
import { FeedbackError } from "./errors";
import { SCHEMA, type FeedbackDatabase } from "./sql";

let database: Promise<FeedbackDatabase> | undefined;

export function getFeedbackClientAddress(request: Request) {
  // Only Vercel's server-owned forwarding header is trusted in the Node runtime.
  return process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown" : "local";
}

async function connect(): Promise<FeedbackDatabase> {
  const url = process.env.FEEDBACK_DATABASE_URL;
  const deployed = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  if (deployed && (!url || !/^(libsql|https):\/\//.test(url) || !process.env.FEEDBACK_DATABASE_TOKEN)) {
    throw new FeedbackError(503, "오류 제보를 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  }
  let client;
  if (url) {
    if (!/^(libsql|https):\/\//.test(url)) throw new FeedbackError(503, "제보 저장소 설정을 확인해 주세요.");
    client = createClient({ url, authToken: process.env.FEEDBACK_DATABASE_TOKEN });
  } else {
    // Local Node/Next development only. Never use an ephemeral Vercel filesystem.
    await mkdir(path.join(process.cwd(), "output", "feedback"), { recursive: true });
    const local = await import("@libsql/client");
    client = local.createClient({ url: `file:${path.join(process.cwd(), "output", "feedback", "reports.sqlite")}` });
  }
  const db: FeedbackDatabase = {
    execute: async (statement) => {
      const result = await client.execute(statement);
      return { rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected };
    },
    batch: async (statements) => (await client.batch(statements, "write")).map((result) => ({
      rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected,
    })),
  };
  await db.batch(SCHEMA);
  return db;
}

export async function getFeedbackDatabase(): Promise<FeedbackDatabase> {
  database ??= connect().catch((error) => { database = undefined; throw error; });
  return database;
}

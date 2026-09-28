import { env } from "cloudflare:workers";
import { createClient } from "@libsql/client/web";
import type { D1Database } from "@cloudflare/workers-types";
import { SCHEMA, type FeedbackDatabase } from "../features/feedback/server/sql";
import { FeedbackError } from "../features/feedback/server/errors";

let database: Promise<FeedbackDatabase> | undefined;

export function getFeedbackClientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

async function connect(): Promise<FeedbackDatabase> {
  const url = process.env.FEEDBACK_DATABASE_URL;
  let db: FeedbackDatabase;
  if (url) {
    if (!/^(libsql|https):\/\//.test(url)) throw new FeedbackError(503, "제보 저장소 설정을 확인해 주세요.");
    const client = createClient({ url, authToken: process.env.FEEDBACK_DATABASE_TOKEN });
    db = {
      execute: async (statement) => {
        const result = await client.execute(statement);
        return { rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected };
      },
      batch: async (statements) => (await client.batch(statements, "write")).map((result) => ({
        rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected,
      })),
    };
  } else {
    const binding = (env as unknown as { FEEDBACK_DB?: D1Database }).FEEDBACK_DB;
    if (!binding) throw new FeedbackError(503, "오류 제보를 준비 중입니다. 잠시 후 다시 시도해 주세요.");
    const prepare = (statement: { sql: string; args?: (string | number | null)[] }) =>
      binding.prepare(statement.sql).bind(...(statement.args ?? []));
    db = {
      execute: async (statement) => {
        const result = await prepare(statement).all();
        return { rows: result.results, rowsAffected: result.meta.changes };
      },
      batch: async (statements) => (await binding.batch<Record<string, unknown>>(statements.map(prepare))).map((result) => ({
        rows: result.results, rowsAffected: result.meta.changes,
      })),
    };
  }
  await db.batch(SCHEMA);
  return db;
}

export async function getFeedbackDatabase(): Promise<FeedbackDatabase> {
  database ??= connect().catch((error) => { database = undefined; throw error; });
  return database;
}

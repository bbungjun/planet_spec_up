import { getFeedbackDatabase } from "@/features/feedback/server/database";
import { FEEDBACK_STATUSES, type FeedbackInput, type FeedbackList, type FeedbackReport, type FeedbackStatus } from "../types";
import { FeedbackError } from "./errors";
import type { FeedbackDatabase, Statement } from "./sql";

type Quota = { key: string; limit: number; end: number };
function quotas(prefix: string, clientKey: string, now: number, clientLimit: number, window: number, globalLimit: number): Quota[] {
  return [
    { key: `${prefix}:client:${clientKey}:${Math.floor(now / window)}`, limit: clientLimit, end: (Math.floor(now / window) + 1) * window },
    { key: `${prefix}:global:${Math.floor(now / 3_600_000)}`, limit: globalLimit, end: (Math.floor(now / 3_600_000) + 1) * 3_600_000 },
  ];
}
function quotaStatement(quota: Quota, reportId?: string): Statement {
  return {
    sql: `INSERT INTO feedback_limits(key, hits, expires_at)
      SELECT ?, 1, ? ${reportId ? "WHERE NOT EXISTS (SELECT 1 FROM feedback_reports WHERE id = ?)" : "WHERE 1"}
      ON CONFLICT(key) DO UPDATE SET hits = min(feedback_limits.hits + 1, ?)
      RETURNING hits`,
    args: [quota.key, quota.end, ...(reportId ? [reportId] : []), quota.limit + 1],
  };
}
export class FeedbackStore {
  constructor(private db: FeedbackDatabase) {}
  async consumeLoginQuota(clientKey: string, now = Date.now()) {
    const limits = quotas("login", clientKey, now, 8, 900_000, 300);
    const results = await this.db.batch([
      { sql: "DELETE FROM feedback_limits WHERE expires_at <= ?", args: [now] },
      ...limits.map((quota) => quotaStatement(quota)),
    ]);
    const blocked = limits.filter((quota, index) => Number(results[index + 1].rows[0]?.hits) > quota.limit);
    if (blocked.length) {
      throw new FeedbackError(429, "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.", Math.max(1, Math.ceil((Math.max(...blocked.map((quota) => quota.end)) - now) / 1000)));
    }
  }
  async create(input: FeedbackInput, clientKey: string, now = Date.now()) {
    const limits = quotas("post", clientKey, now, 5, 600_000, 100);
    const timestamp = new Date(now).toISOString();
    // Admission and insertion share a transaction, including across server instances.
    const results = await this.db.batch([
      { sql: "DELETE FROM feedback_limits WHERE expires_at <= ?", args: [now] },
      ...limits.map((quota) => quotaStatement(quota, input.id)),
      {
        sql: `INSERT INTO feedback_reports(id, category, title, description, environment, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT hits FROM feedback_limits WHERE key = ?) <= ?
            AND (SELECT hits FROM feedback_limits WHERE key = ?) <= ?
          ON CONFLICT(id) DO NOTHING`,
        args: [input.id, input.category, input.title, input.description, input.environment, timestamp, timestamp,
          limits[0].key, limits[0].limit, limits[1].key, limits[1].limit],
      },
      { sql: "SELECT id FROM feedback_reports WHERE id = ?", args: [input.id] },
    ]);
    // Lost acknowledgements can be retried without inserting the report twice.
    if (!results[4].rows.length) {
      const blocked = limits.filter((quota, index) => Number(results[index + 1].rows[0]?.hits) > quota.limit);
      throw new FeedbackError(429, "제보가 연속으로 접수됐습니다. 잠시 후 다시 시도해 주세요.", Math.max(1, Math.ceil((Math.max(...blocked.map((quota) => quota.end)) - now) / 1000)));
    }
    return { id: input.id };
  }
  async list(parameters: URLSearchParams): Promise<FeedbackList> {
    const status = parameters.get("status") ?? "all";
    const cursorText = parameters.get("cursor");
    const cursor = cursorText === null ? Number.MAX_SAFE_INTEGER : Number(cursorText);
    const search = (parameters.get("search") ?? "").trim();
    if ((status !== "all" && !Object.hasOwn(FEEDBACK_STATUSES, status)) || !Number.isSafeInteger(cursor) || cursor < 1 || search.length > 100) {
      throw new FeedbackError(400, "조회 조건을 확인해 주세요.");
    }
    const result = await this.db.execute({
      sql: `SELECT * FROM feedback_reports WHERE sequence < ?
        AND (? = 'all' OR status = ?)
        AND (? = '' OR instr(lower(title || '\n' || description || '\n' || admin_note), lower(?)) > 0)
        ORDER BY sequence DESC LIMIT 21`,
      args: [cursor, status, status, search, search],
    });
    const reports = result.rows.slice(0, 20).map(reportFromRow);
    return { reports, nextCursor: result.rows.length > 20 ? reports[19].sequence : null };
  }
  async update(id: string, input: { status: FeedbackStatus; adminNote: string; updatedAt: string }) {
    const timestamp = new Date(Math.max(Date.now(), Date.parse(input.updatedAt) + 1));
    if (!Number.isFinite(timestamp.getTime())) throw new FeedbackError(400, "제보를 다시 불러와 주세요.");
    const result = await this.db.execute({
      sql: "UPDATE feedback_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ? AND updated_at = ? RETURNING *",
      args: [input.status, input.adminNote, timestamp.toISOString(), id, input.updatedAt],
    });
    if (!result.rows.length) throw new FeedbackError(409, "제보가 변경되거나 삭제됐습니다. 새로고침 후 다시 시도해 주세요.");
    return reportFromRow(result.rows[0]);
  }
  async remove(id: string, updatedAt: string) {
    const result = await this.db.execute({ sql: "DELETE FROM feedback_reports WHERE id = ? AND updated_at = ?", args: [id, updatedAt] });
    if (!result.rowsAffected) throw new FeedbackError(409, "제보가 변경되거나 삭제됐습니다. 새로고침 후 다시 시도해 주세요.");
  }
}
function reportFromRow(row: Record<string, unknown>): FeedbackReport {
  return {
    sequence: Number(row.sequence), id: String(row.id), category: row.category as FeedbackReport["category"],
    title: String(row.title), description: String(row.description), environment: String(row.environment),
    status: row.status as FeedbackStatus, adminNote: String(row.admin_note),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
export async function getFeedbackStore() { return new FeedbackStore(await getFeedbackDatabase()); }

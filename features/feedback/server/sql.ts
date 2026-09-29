export type Statement = { sql: string; args?: (string | number | null)[] };
export type SqlResult = { rows: Record<string, unknown>[]; rowsAffected: number };
export type FeedbackDatabase = {
  execute(statement: Statement): Promise<SqlResult>;
  // All statements must execute in one write transaction.
  batch(statements: Statement[]): Promise<SqlResult[]>;
};

export const SCHEMA: Statement[] = [
  { sql: `CREATE TABLE IF NOT EXISTS feedback_reports (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','investigating','resolved','closed')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )` },
  { sql: `CREATE INDEX IF NOT EXISTS feedback_reports_status ON feedback_reports(status, sequence)` },
  { sql: `CREATE TABLE IF NOT EXISTS feedback_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )` },
];

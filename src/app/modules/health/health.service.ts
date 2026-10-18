import { query } from "../../utils/db";

type PingSource = "cron" | "http";

type PingRecord = { at: string; latency_ms: number; source: PingSource };

// Tracked per source. A single "last ping" field would be overwritten by every
// health request, which is exactly the case where you cannot tell whether the
// scheduled job is still firing — the one thing worth knowing here.
const lastPing: Record<PingSource, PingRecord | null> = {
  cron: null,
  http: null,
};

// Supabase pauses a free project after ~7 days with no database activity, so
// something has to touch it on a schedule. This is that touch.
//
// It reads from a real table rather than running SELECT 1: a bare constant can
// be answered without going near storage, and the point here is to be
// unmistakable database usage. The read is a single indexed row, so it costs
// nothing worth measuring.
const pingDatabase = async (source: PingSource = "http") => {
  const startedAt = Date.now();

  const result = await query(
    `SELECT (SELECT id FROM users LIMIT 1) as sample, NOW() as db_time`,
  );

  const latency = Date.now() - startedAt;

  lastPing[source] = {
    at: new Date().toISOString(),
    latency_ms: latency,
    source,
  };

  return {
    database: "reachable",
    latency_ms: latency,
    db_time: result.rows[0]?.db_time ?? null,
  };
};

// In memory only. A restart clears it, which is the honest answer after a
// restart: this instance has not run the scheduled job yet.
const getLastCronPing = () => lastPing.cron;

export const HealthService = { pingDatabase, getLastCronPing };

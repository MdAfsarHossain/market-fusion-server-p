import { QueryResult } from "pg";
import { pool } from "../../config/database";

// Helper function for queries
export const query = async (
  text: string,
  params?: any[],
): Promise<QueryResult> => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    // console.log('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error("Query error:", { text, error });
    throw error;
  }
};

// Transaction helper
export const transaction = async <T>(
  callback: (client: any) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  // The pool's own "error" listener only covers clients sitting idle in the
  // pool. While a client is checked out it is ours, so a socket that dies
  // mid-transaction emits "error" here with nobody listening — which Node turns
  // into an uncaught exception and the whole API goes down. Observed in the wild
  // as `read ETIMEDOUT` from the connection pooler.
  const onClientError = (error: Error) => {
    console.error("⚠️  Client error during transaction:", error.message);
  };

  client.on("error", onClientError);

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A rollback on a broken connection throws too, which would replace the
    // real failure with a confusing one. The pool discards the client either
    // way, so the original error is what the caller needs to see.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError: any) {
      console.error("⚠️  Rollback failed:", rollbackError?.message);
    }
    throw error;
  } finally {
    client.removeListener("error", onClientError);
    client.release();
  }
};

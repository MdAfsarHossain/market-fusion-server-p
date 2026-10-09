import { directPool } from "../../config/database";
import { query } from "./db";

export const checkExpiredSubscriptionAndDowngrade = async () => {
  try {
    console.log("Checking for expiring subscriptions... from Downgrade file");

    // Find all subscriptions that have expired (next_payment_date is in the past)
    const expiredSubscriptionsResult = await query(`
            SELECT 
                id, 
                user_id, 
                status, 
                next_payment_date
            FROM user_subscriptions
            WHERE status = 'ACTIVE'::"SubscriptionStatus"
                AND next_payment_date <= CURRENT_TIMESTAMP
        `);

    const expiredSubscriptions = expiredSubscriptionsResult.rows;

    if (expiredSubscriptions.length === 0) {
      console.log("No expired subscriptions found");
      return { updatedCount: 0, message: "No expired subscriptions found" };
    }

    let updatedCount = 0;
    let failedCount = 0;

    // Process each expired subscription
    for (const subscription of expiredSubscriptions) {
      try {
        // Start a transaction for each subscription
        // const client = await (await import('../config/database')).directPool.connect();

        const client = await directPool.connect();

        try {
          await client.query("BEGIN");

          // Update subscription status to COMPLETED
          const subscriptionResult = await client.query(
            `
                        UPDATE user_subscriptions 
                        SET 
                            status = 'COMPLETED',
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = $1::uuid
                        RETURNING id, user_id, status
                    `,
            [subscription.id],
          );

          if (subscriptionResult.rows.length === 0) {
            console.error(`Failed to update subscription ${subscription.id}`);
            failedCount++;
            await client.query("ROLLBACK");
            continue;
          }

          // Update user's plan_type to FREE
          const userResult = await client.query(
            `
                        UPDATE users 
                        SET 
                            plan_type = 'FREE'::"PlanType",
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = $1::uuid
                        RETURNING id, plan_type
                    `,
            [subscription.user_id],
          );

          if (userResult.rows.length === 0) {
            console.error(`Failed to update user ${subscription.user_id}`);
            failedCount++;
            await client.query("ROLLBACK");
            continue;
          }

          await client.query("COMMIT");
          updatedCount++;

          console.log(
            `Subscription ${subscription.id} for user ${subscription.user_id} marked as COMPLETED and downgraded to FREE`,
          );
        } catch (error) {
          await client.query("ROLLBACK");
          console.error(
            `Error processing subscription ${subscription.id}:`,
            error,
          );
          failedCount++;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error(
          `Error in transaction for subscription ${subscription.id}:`,
          error,
        );
        failedCount++;
      }
    }

    console.log(
      `Checked and updated ${updatedCount} expired subscriptions (${failedCount} failed)`,
    );

    return {
      updatedCount,
      failedCount,
      totalFound: expiredSubscriptions.length,
      message: `Processed ${expiredSubscriptions.length} expired subscriptions. Updated: ${updatedCount}, Failed: ${failedCount}`,
    };
  } catch (error) {
    console.error("Error checking expiring subscriptions:", error);
    return {
      updatedCount: 0,
      failedCount: 0,
      totalFound: 0,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to check expired subscriptions",
    };
  }
};

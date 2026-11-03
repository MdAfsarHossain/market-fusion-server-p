// import { Request, Response } from "express";
// import { MollieService } from "../mollie/mollie.service";
// import { pool } from "../../../config/database";
// import { query } from "../../utils/db";
// const MollieClient = require("@mollie/api-client").createMollieClient;

// // // ─── Initialize Mollie Client ────────────────────────────────────────────────
// const mollieClient = MollieClient({
//   apiKey: process.env.MOLLIE_API_KEY, // test_xxxx or live_xxxx
// });

// // Mollie Payment Webhook
// const molliePaymentWebhook = async (req: Request, res: Response) => {
//   const client = await pool.connect();

//   try {
//     console.log(`Mollie Webhook Body: .....`);

//     // console.log(req.body);

//     const molliePaymentId = req.body.id;

//     // 1. Always acknowledge receipt immediately
//     res.status(200).send("OK");

//     // console.log(`Mollie Payment ID: ${molliePaymentId}`);

//     if (!molliePaymentId) {
//       console.error("No payment ID in webhook request");
//       return res.status(400).json({ error: "No payment ID provided" });
//     }

//     // Fetch latest payment status from Mollie API
//     const molliePayment = await mollieClient.payments.get(molliePaymentId);
//     // console.log(`Mollie Payment: .....`);

//     // console.log(molliePayment);

//     // Find our local payment record
//     // let paymentResult = await query(
//     //   `
//     //         SELECT * FROM payments
//     //         WHERE mollie_payment_id = $1
//     //   `,
//     //   [molliePaymentId],
//     // );

//     // // Idempotency check: If the order is already marked as 'PAID', stop processing.
//     // if (paymentResult.rows[0]?.payment_status === "PAID") {
//     //   console.log(
//     //     `Webhook for payment ${molliePaymentId} already processed. Skipping.`,
//     //   );
//     //   return;
//     // }

//     // Determine payment type
//     // if (molliePayment.subscriptionId) {
//     //   console.log("This is a subscription payment");
//     //   console.log("Subscription ID:", molliePayment.subscriptionId);
//     //   console.log("Customer ID:", molliePayment.customerId);
//     //   console.log("Sequence type:", molliePayment.sequenceType); // 'recurring'
//     // } else {
//     //   console.log("This is a one-time payment");
//     //   console.log("Sequence type:", molliePayment.sequenceType); // 'oneoff'
//     // }

//     // Check payment status
//     // console.log("Payment status:", molliePayment.status);
//     // Possible values: 'open', 'pending', 'paid', 'failed', 'expired', 'canceled'

//     // Check amount
//     // console.log(
//     //   "Amount:",
//     //   molliePayment.amount.value,
//     //   molliePayment.amount.currency,
//     // );

//     // Check metadata (if you stored custom data)
//     // console.log("Metadata:", molliePayment.metadata);

//     console.log("Mollie Payment Details:", {
//       id: molliePayment.id,
//       status: molliePayment.status,
//       amount: molliePayment.amount,
//       subscriptionId: molliePayment.subscriptionId,
//       customerId: molliePayment.customerId,
//       sequenceType: molliePayment.sequenceType,
//       metadata: molliePayment.metadata,
//       paidAt: molliePayment.paidAt,
//       createdAt: molliePayment.createdAt,
//     });

//     // if (molliePayment.subscriptionId) {
//     // ✅ Check if it's a subscription payment (has customerId and sequenceType)
//     if (
//       molliePayment.customerId &&
//       (molliePayment.sequenceType === "first" ||
//         molliePayment.sequenceType === "recurring")
//     ) {
//       console.log(`This is a subscription payment`);

//       const { status, metadata, mandateId } = molliePayment;
//       const mollieSubId = (molliePayment as any).subscriptionId;

//       // Find our local payment record
//       let paymentResult = await query(
//         `
//             SELECT * FROM payments 
//             WHERE mollie_payment_id = $1
//       `,
//         [molliePaymentId],
//       );

//       console.log(`paymentResult: .....`);

//       console.log(paymentResult.rows[0]);

//       if (paymentResult.rows[0].status === "PAID") {
//         console.log(
//           `Webhook for payment ${molliePaymentId} already processed. Skipping.`,
//         );
//         return;
//       }

//       let payment = paymentResult.rows[0] || null;

//       // For subscription recurring payments, create payment record if not exists
//       if (!payment && mollieSubId) {
//         const userSubResult = await query(
//           `
//                 SELECT 
//                     us.id as subscription_id,
//                     us.user_id,
//                     us.plan_id,
//                     sp.name as plan_name,
//                     sp.currency
//                 FROM user_subscriptions us
//                 LEFT JOIN subscriptions_plan sp ON us.plan_id = sp.id
//                 WHERE us.mollie_subscription_id = $1
//                 LIMIT 1
//             `,
//           [mollieSubId],
//         );

//         if (userSubResult.rows.length > 0) {
//           const userSub = userSubResult.rows[0];

//           const insertResult = await query(
//             `
//                     INSERT INTO payments (
//                         user_id,
//                         subscription_id,
//                         mollie_payment_id,
//                         mollie_customer_id,
//                         amount,
//                         currency,
//                         description,
//                         status,
//                         payment_type,
//                         metadata,
//                         "createdAt",
//                         "updatedAt"
//                     ) VALUES (
//                         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::"PaymentStatus", 
//                         $9::"PaymentType", $10::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
//                     )
//                     RETURNING *
//                 `,
//             [
//               userSub.user_id,
//               userSub.subscription_id,
//               molliePaymentId,
//               molliePayment.customerId,
//               parseFloat(molliePayment.amount.value),
//               molliePayment.amount.currency,
//               molliePayment.description,
//               "PENDING",
//               "SUBSCRIPTION_RECURRING",
//               JSON.stringify({
//                 mollieSubscriptionId: mollieSubId,
//                 originalMetadata: metadata,
//               }),
//             ],
//           );

//           payment = insertResult.rows[0];
//         } else {
//           console.warn(
//             `No user subscription found for Mollie subscription ID: ${mollieSubId}`,
//           );
//           return res
//             .status(200)
//             .json({ received: true, message: "Subscription not found" });
//         }
//       }

//       if (!payment) {
//         console.warn(
//           `No payment record found for Mollie ID: ${molliePaymentId}`,
//         );
//         return res
//           .status(200)
//           .json({ received: true, message: "Payment record not found" });
//       }

//       // Map Mollie statuses to our enum
//       const statusMap: any = {
//         paid: "PAID",
//         failed: "FAILED",
//         canceled: "CANCELLED",
//         expired: "EXPIRED",
//       };

//       const newStatus = statusMap[status] || payment.status;

//       // Start transaction for updates
//       await client.query("BEGIN");

//       // Update payment record
//       await client.query(
//         `
//             UPDATE payments 
//             SET 
//                 status = $1::"PaymentStatus",
//                 mollie_mandate_id = COALESCE($2, mollie_mandate_id),
//                 paid_at = CASE WHEN $3 = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,
//                 failed_at = CASE WHEN $3 = 'failed' THEN CURRENT_TIMESTAMP ELSE failed_at END,
//                 expired_at = CASE WHEN $3 = 'expired' THEN CURRENT_TIMESTAMP ELSE expired_at END,
//                 "updatedAt" = CURRENT_TIMESTAMP
//             WHERE id = $4::uuid
//         `,
//         [newStatus, mandateId, status, payment.id],
//       );

//       // Handle paid status
//       if (status === "paid") {
//         // CASE A: First subscription payment
//         if (payment.payment_type === "SUBSCRIPTION_FIRST" && mandateId) {
//           if (!payment.subscription_id) {
//             console.error("No subscription_id found for first payment");
//           } else {
//             try {
//               // Call activate subscription function
//               await MollieService.activateMollieSubscription(
//                 payment.subscription_id,
//                 (payment.metadata as any)?.interval as "MONTHLY" | "YEARLY",
//                 mandateId,
//               );
//             } catch (error) {
//               console.error("Error activating subscription:", error);
//             }
//           }
//         }

//         // CASE B: Recurring subscription payment
//         else if (
//           payment.payment_type === "SUBSCRIPTION_RECURRING" &&
//           payment.subscription_id
//         ) {
//           const userSubResult = await client.query(
//             `
//                     SELECT 
//                         id,
//                         user_id,
//                         mollie_customer_id,
//                         mollie_subscription_id
//                     FROM user_subscriptions 
//                     WHERE id = $1::uuid
//                 `,
//             [payment.subscription_id],
//           );

//           if (userSubResult.rows.length === 0) {
//             console.error(
//               `User subscription not found: ${payment.subscription_id}`,
//             );
//           } else {
//             const userSubscription = userSubResult.rows[0];

//             if (
//               !userSubscription.mollie_customer_id ||
//               !userSubscription.mollie_subscription_id
//             ) {
//               console.error("Missing Mollie IDs for subscription:", {
//                 customerId: userSubscription.mollie_customer_id,
//                 subscriptionId: userSubscription.mollie_subscription_id,
//               });
//             } else {
//               try {
//                 // Use direct API call instead of SDK
//                 const apiKey =
//                   process.env.MOLLIE_API_KEY || process.env.MOLLIE_TEST_API_KEY;
//                 const url = `https://api.mollie.com/v2/customers/${userSubscription.mollie_customer_id}/subscriptions/${userSubscription.mollie_subscription_id}`;

//                 const response = await fetch(url, {
//                   method: "GET",
//                   headers: {
//                     Authorization: `Bearer ${apiKey}`,
//                     "Content-Type": "application/json",
//                   },
//                 });

//                 if (!response.ok) {
//                   const errorData = await response.json();
//                   throw new Error(
//                     `Mollie API error: ${errorData.title || response.statusText}`,
//                   );
//                 }

//                 const refreshedSub = await response.json();

//                 await client.query(
//                   `
//                                 UPDATE user_subscriptions 
//                                 SET 
//                                     next_payment_date = $1,
//                                     status = $2::"SubscriptionStatus",
//                                     "updatedAt" = CURRENT_TIMESTAMP
//                                 WHERE id = $3::uuid
//                             `,
//                   [
//                     refreshedSub.nextPaymentDate
//                       ? new Date(refreshedSub.nextPaymentDate)
//                       : null,
//                     refreshedSub.status === "active" ? "ACTIVE" : "CANCELLED",
//                     payment.subscription_id,
//                   ],
//                 );

//                 await client.query(
//                   `
//                                 UPDATE users 
//                                 SET 
//                                     start_date = CURRENT_TIMESTAMP,
//                                     next_payment_date = $1,
//                                     "updatedAt" = CURRENT_TIMESTAMP
//                                 WHERE id = $2::uuid
//                             `,
//                   [
//                     refreshedSub.nextPaymentDate
//                       ? new Date(refreshedSub.nextPaymentDate)
//                       : null,
//                     userSubscription.user_id,
//                   ],
//                 );

//                 console.log("Subscription next payment date updated");
//               } catch (error) {
//                 console.error("Error updating recurring subscription:", error);
//               }
//             }
//           }
//         }

//         // CASE C: One-time payment
//         else if (payment.payment_type === "ONE_TIME") {
//           console.log(`CASE C: ONE_TIME PAYMENT`);
//         }

//         // Generate invoice for every paid payment
//         try {
//           await MollieService.generateInvoice(payment.id);
//           console.log("Invoice generated successfully");
//           console.log(`User ID: ${payment.user_id}`);
//         } catch (error) {
//           console.error("Error generating invoice:", error);
//         }
//       }

//       // Handle failed/cancelled first payment
//       if (
//         ["failed", "canceled", "expired"].includes(status) &&
//         payment.payment_type === "SUBSCRIPTION_FIRST"
//       ) {
//         console.log(`First payment failed/cancelled: ${status}`);

//         const subscriptionId =
//           metadata?.subscription_id || payment.subscription_id;

//         if (subscriptionId) {
//           await client.query(
//             `
//                     UPDATE user_subscriptions 
//                     SET 
//                         status = 'FAILED',
//                         "updatedAt" = CURRENT_TIMESTAMP
//                     WHERE id = $1::uuid
//                 `,
//             [subscriptionId],
//           );
//           console.log(`Subscription ${subscriptionId} marked as FAILED`);
//         }
//       }

//       // Handle failed recurring payment
//       if (
//         ["failed", "canceled", "expired"].includes(status) &&
//         payment.payment_type === "SUBSCRIPTION_RECURRING" &&
//         payment.subscription_id
//       ) {
//         console.log(`Recurring payment failed: ${status}`);

//         await client.query(
//           `
//                 UPDATE user_subscriptions 
//                 SET 
//                     status = 'FAILED',
//                     "updatedAt" = CURRENT_TIMESTAMP
//                 WHERE id = $1::uuid
//             `,
//           [payment.subscription_id],
//         );
//       }

//       await client.query("COMMIT");

//       //res.status(200).json({ received: true, payment_id: payment.id });
//       return payment;
//     } else {
//       console.log(`This is a one-time payment`);

//       // Check payment status
//       console.log("Payment status:", molliePayment.status);
//       // Possible values: 'open', 'pending', 'paid', 'failed', 'expired', 'canceled'

//       const existingOrder = await query(
//         `
//           SELECT * FROM orders
//           WHERE mollie_payment_id = $1
//           `,
//         [molliePayment.id],
//       );

//       const order = existingOrder.rows[0];

//       if (order?.payment_status === "PAID") {
//         console.log(
//           `Webhook for payment ${molliePayment.id} already processed. Skipping.`,
//         );
//         return;
//       }

//       if (molliePayment.status === "paid") {
//         // ORDERS TABLE
//         // mollie_payment_id
//         // payment_status
//         // status
//         // paid_at
//         // get order_id for order_items

//         const orders = await query(
//           `
//           UPDATE orders
//           SET 
//             payment_status = 'PAID',
//             status = 'CONFIRMED',
//             paid_at = CURRENT_TIMESTAMP
//           WHERE mollie_payment_id = $1
//           RETURNING id, user_id, branches_id, order_number;
//           `,
//           [molliePayment.id],
//         );

//         const orderItems = await query(
//           `
//           SELECT id FROM order_items WHERE order_id = $1
//           `,
//           [orders.rows[0].id],
//         );

//         // ORDER ITEMS TABLE
//         //
//         // UPDATE INVENTORY PAYMENTS TABLE
//         // mollie_payment_id
//         // update status
//         // update paid_at

//         await query(
//           `
//           UPDATE inventory_payments
//           SET status = 'PAID',
//             paid_at = CURRENT_TIMESTAMP
//           WHERE order_id = $1 AND mollie_payment_id = $2
//           `,
//           [orders.rows[0].id, molliePayment.id],
//         );

//         console.log(`Orders ID: ${orders.rows[0].id}`);
//         console.log(`User ID: ${orders.rows[0].user_id}`);
//         console.log(`Branch ID: ${orders.rows[0].branches_id}`);
//         console.log(`Order Number: ${orders.rows[0].order_number}`);

//         for (const branch_id of orders.rows[0].branches_id) {
//           await query(
//             `
//           INSERT INTO notifications (
//             user_id,
//             title,
//             description,
//             branch_id,
//             is_read,
//             "createdAt",
//             "updatedAt"
//           )
//           VALUES ($1, $2, $3, $4, $5, $6, $7)
//           RETURNING id
//           `,
//             [
//               orders.rows[0].user_id,
//               "Order",
//               // `Your Branch Order #${orders.rows[0].order_number} has been paid`,
//               `Your branch received a new order #${orders.rows[0].order_number}.`,
//               //orders.rows[0].branch_id,
//               branch_id,
//               false,
//               new Date(),
//               new Date(),
//             ],
//           );
//         }
//       }

//       if (molliePayment.status === "failed") {
//         //

//         const orders = await query(
//           `
//           UPDATE orders
//           SET payment_status = 'FAILED',
//             -- status = 'FAILED',
//             -- paid_at = CURRENT_TIMESTAMP
//           WHERE mollie_payment_id = $1
//           RETURNING id;
//           `,
//           [molliePayment.id],
//         );

//         await query(
//           `
//           UPDATE inventory_payments
//           SET status = 'FAILED',
//             paid_at = CURRENT_TIMESTAMP
//           WHERE order_id = $1 AND mollie_payment_id = $2
//           `,
//           [orders.rows[0].id, molliePayment.id],
//         );
//       }

//       if (molliePayment.status === "expired") {
//         //

//         const orders = await query(
//           `
//           UPDATE orders
//           SET payment_status = 'EXPIRED',
//             -- status = 'EXPIRED',
//             -- paid_at = CURRENT_TIMESTAMP
//           WHERE mollie_payment_id = $1
//           RETURNING id;
//           `,
//           [molliePayment.id],
//         );

//         await query(
//           `
//           UPDATE inventory_payments
//           SET status = 'EXPIRED',
//             -- paid_at = CURRENT_TIMESTAMP
//           WHERE order_id = $1 AND mollie_payment_id = $2
//           `,
//           [orders.rows[0].id, molliePayment.id],
//         );
//       }

//       if (molliePayment.status === "canceled") {
//         //

//         const orders = await query(
//           `
//           UPDATE orders
//           SET payment_status = 'CANCELED',
//             status = 'CANCELLED',
//             paid_at = CURRENT_TIMESTAMP
//           WHERE mollie_payment_id = $1
//           RETURNING id;
//           `,
//           [molliePayment.id],
//         );

//         await query(
//           `
//           UPDATE inventory_payments
//           SET status = 'CANCELLED',
//             paid_at = CURRENT_TIMESTAMP
//           WHERE order_id = $1 AND mollie_payment_id = $2
//           `,
//           [orders.rows[0].id, molliePayment.id],
//         );
//       }

//       //  One Time Payment
//       // ORDERS TABLE
//       // mollie_payment_id
//       // payment_status
//       // status
//       // paid_at
//       // get order_id for order_items
//       // ORDER ITEMS TABLE
//       //
//       // UPDATE INVENTORY PAYMENTS TABLE
//       // mollie_payment_id
//       // update status
//       // update paid_at
//     }
//   } catch (error: any) {
//     await client.query("ROLLBACK");
//     console.error("Webhook processing error:", error);

//     // res.status(200).json({
//     //   received: true,
//     //   error: error.message,
//     //   message: "Webhook received but processing had issues",
//     // });
//   } finally {
//     client.release();
//   }
// };

// export const WebhooksService = {
//   molliePaymentWebhook,
// };

// /**
//  * 
//  * Mollie Webhook Body: .....
// { id: 'tr_GEV4N9GXY7UzgmxiWxBSJ' }
// Mollie Payment: .....
// Payment tr_GEV4N9GXY7UzgmxiWxBSJ {
//   amount: { currency: 'EUR', value: '35.00' },
//   amountRefunded: { currency: 'EUR', value: '0.00' },
//   amountRemaining: { currency: 'EUR', value: '35.00' },
//   countryCode: 'BD',
//   createdAt: '2026-06-05T10:03:21+00:00',
//   description: 'Order ORD-53799206-1293',
//   details: {
//     cardAudience: 'consumer',
//     cardCountryCode: 'NL',
//     cardHolder: 'T. TEST',
//     cardIssuerCountry: 'NL',
//     cardLabel: 'Mastercard',
//     cardNumber: '1111',
//     cardToken: 'tkn_9airzKtest',
//     feeRegion: 'intra-eu',
//     fraudScore: 3.3
//   },
//   locale: 'en_US',
//   metadata: {
//     order_id: '57a1f3bf-350e-42f9-a8c3-253cdf36a72f',
//     order_number: 'ORD-53799206-1293',
//     user_id: '04791fa5-37b9-4874-99b5-c13691f71314'
//   },
//   method: 'creditcard',
//   mode: 'test',
//   paidAt: '2026-06-05T10:05:44+00:00',
//   profileId: 'pfl_VRWFSxG9bW',
//   redirectUrl: 'https://www.portal.business.resqueu.nl/payment-success',
//   sequenceType: 'oneoff',
//   settlementAmount: { currency: 'EUR', value: '35.00' },
//   status: 'paid',
//   webhookUrl: 'https://8e6d-103-245-109-228.ngrok-free.app/api/v2/webhooks/mollie'
// }
// This is a one-time payment
// Sequence type: oneoff
// Payment status: paid
// Amount: 35.00 EUR
// Metadata: {
//   order_id: '57a1f3bf-350e-42f9-a8c3-253cdf36a72f',
//   order_number: 'ORD-53799206-1293',
//   user_id: '04791fa5-37b9-4874-99b5-c13691f71314'
// }
// Mollie Payment Details: {
//   id: 'tr_GEV4N9GXY7UzgmxiWxBSJ',
//   status: 'paid',
//   amount: { value: '35.00', currency: 'EUR' },
//   subscriptionId: undefined,
//   customerId: undefined,
//   sequenceType: 'oneoff',
//   metadata: {
//     order_id: '57a1f3bf-350e-42f9-a8c3-253cdf36a72f',
//     order_number: 'ORD-53799206-1293',
//     user_id: '04791fa5-37b9-4874-99b5-c13691f71314'
//   },
//   paidAt: '2026-06-05T10:05:44+00:00',
//   createdAt: '2026-06-05T10:03:21+00:00'
// }
// No payment record found for Mollie ID: tr_GEV4N9GXY7UzgmxiWxBSJ
//  */

import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import config from "../../../config";
import { query, transaction } from "../../utils/db";
import { enqueueNotifications } from "../../queues/notification.queue";

const toMoney = (value: number) => Number(value.toFixed(2));

// Fetch a user's wallet, creating it the first time it is needed
const getOrCreateWallet = async (userId: string, client?: any) => {
  const run = client
    ? (text: string, params: any[]) => client.query(text, params)
    : query;

  const existing = await run(
    `SELECT * FROM wallets WHERE user_id = $1::uuid`,
    [userId],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // ON CONFLICT keeps two concurrent first-time writes from colliding
  const created = await run(
    `
        INSERT INTO wallets (user_id, "createdAt", "updatedAt")
        VALUES ($1::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
        RETURNING *
    `,
    [userId],
  );

  return created.rows[0];
};

// Move money in or out of a wallet and write the ledger row.
//
// Always call this inside a transaction: the wallet row is locked FOR UPDATE so
// concurrent credits cannot read a stale balance.
const applyTransaction = async (
  client: any,
  input: {
    userId: string;
    type: "CREDIT" | "DEBIT";
    source: string;
    amount: number;
    referenceType?: string | null;
    referenceId?: string | null;
    description?: string | null;
  },
) => {
  const amount = toMoney(input.amount);

  if (amount <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A wallet transaction amount must be greater than zero.",
    );
  }

  await getOrCreateWallet(input.userId, client);

  const locked = await client.query(
    `SELECT * FROM wallets WHERE user_id = $1::uuid FOR UPDATE`,
    [input.userId],
  );

  const wallet = locked.rows[0];
  const currentBalance = Number(wallet.balance);
  const delta = input.type === "CREDIT" ? amount : -amount;
  const newBalance = toMoney(currentBalance + delta);

  if (newBalance < 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient wallet balance. Available: ${currentBalance.toFixed(2)}.`,
    );
  }

  await client.query(
    `
        UPDATE wallets
        SET
            balance = $1,
            total_earned = total_earned + $2,
            total_withdrawn = total_withdrawn + $3,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $4::uuid
    `,
    [
      newBalance,
      input.type === "CREDIT" ? amount : 0,
      input.source === "WITHDRAWAL" ? amount : 0,
      wallet.id,
    ],
  );

  const txn = await client.query(
    `
        INSERT INTO wallet_transactions (
            wallet_id,
            user_id,
            type,
            source,
            amount,
            balance_after,
            currency,
            reference_type,
            reference_id,
            description,
            "createdAt"
        ) VALUES (
            $1::uuid, $2::uuid, $3::"WalletTxnType", $4::"WalletTxnSource",
            $5, $6, $7, $8, $9::uuid, $10, CURRENT_TIMESTAMP
        )
        RETURNING *
    `,
    [
      wallet.id,
      input.userId,
      input.type,
      input.source,
      amount,
      newBalance,
      wallet.currency,
      input.referenceType || null,
      input.referenceId || null,
      input.description || null,
    ],
  );

  return { wallet: { ...wallet, balance: newBalance }, transaction: txn.rows[0] };
};

// Credit a vendor for a completed sub order.
//
// Called when a sub order reaches COMPLETED, not when the buyer pays: the
// marketplace holds the money until fulfilment is confirmed. The partial unique
// index on wallet_transactions makes a repeat call a no-op rather than paying
// the vendor twice.
const creditVendorEarning = async (client: any, subOrderId: string) => {
  const subOrderResult = await client.query(
    `
        SELECT
            so.id,
            so.sub_order_number,
            so.vendor_earning,
            so.order_id,
            s.owner_id,
            o.order_number
        FROM sub_orders so
        INNER JOIN stores s ON so.store_id = s.id
        INNER JOIN orders o ON so.order_id = o.id
        WHERE so.id = $1::uuid
    `,
    [subOrderId],
  );

  if (subOrderResult.rows.length === 0) {
    return null;
  }

  const subOrder = subOrderResult.rows[0];
  const earning = Number(subOrder.vendor_earning);

  if (earning <= 0) {
    return null;
  }

  const alreadyCredited = await client.query(
    `
        SELECT id FROM wallet_transactions
        WHERE reference_id = $1::uuid AND source = 'ORDER_EARNING'::"WalletTxnSource"
    `,
    [subOrderId],
  );

  if (alreadyCredited.rows.length > 0) {
    return null;
  }

  const result = await applyTransaction(client, {
    userId: subOrder.owner_id,
    type: "CREDIT",
    source: "ORDER_EARNING",
    amount: earning,
    referenceType: "sub_order",
    referenceId: subOrderId,
    description: `Earning from order ${subOrder.order_number}`,
  });

  return { ...result, ownerId: subOrder.owner_id, earning };
};

// Refund a cancelled paid order back to the buyer's wallet
const refundOrderToWallet = async (
  client: any,
  orderId: string,
  amount: number,
  userId: string,
  orderNumber: string,
) => {
  if (amount <= 0) {
    return null;
  }

  const alreadyRefunded = await client.query(
    `
        SELECT id FROM wallet_transactions
        WHERE reference_id = $1::uuid AND source = 'ORDER_REFUND'::"WalletTxnSource"
    `,
    [orderId],
  );

  if (alreadyRefunded.rows.length > 0) {
    return null;
  }

  return applyTransaction(client, {
    userId,
    type: "CREDIT",
    source: "ORDER_REFUND",
    amount,
    referenceType: "order",
    referenceId: orderId,
    description: `Refund for cancelled order ${orderNumber}`,
  });
};

// My Wallet
const myWallet = async (userId: string) => {
  const wallet = await getOrCreateWallet(userId);

  const pendingResult = await query(
    `
        SELECT COALESCE(SUM(amount), 0) as pending
        FROM withdrawal_requests
        WHERE user_id = $1::uuid
            AND status IN ('PENDING'::"WithdrawalStatus", 'APPROVED'::"WithdrawalStatus")
    `,
    [userId],
  );

  // Money still sitting in unpaid sub orders, shown so vendors can see it coming
  const upcomingResult = await query(
    `
        SELECT COALESCE(SUM(so.vendor_earning), 0) as upcoming
        FROM sub_orders so
        INNER JOIN stores s ON so.store_id = s.id
        WHERE s.owner_id = $1::uuid
            AND so.status NOT IN ('COMPLETED'::"OrderStatus", 'CANCELLED'::"OrderStatus", 'REFUNDED'::"OrderStatus")
    `,
    [userId],
  );

  return {
    ...wallet,
    // Informational only. requestWithdrawal debits the balance the moment a
    // payout is asked for, so `balance` already excludes anything pending —
    // subtracting it again here would double count and could read negative.
    pending_withdrawal: Number(pendingResult.rows[0].pending),
    upcoming_earning: Number(upcomingResult.rows[0].upcoming),
    available_balance: toMoney(Number(wallet.balance)),
    min_withdrawal: Number(config.wallet.min_withdrawal),
  };
};

// My Transactions
const myTransactions = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;
  const type = filters.type || null;

  const txnResult = await query(
    `
        SELECT *
        FROM wallet_transactions
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR type = $2::"WalletTxnType")
        ORDER BY "createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, type, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM wallet_transactions
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR type = $2::"WalletTxnType")
    `,
    [userId, type],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    data: txnResult.rows,
  };
};

// Request a withdrawal. The amount is debited immediately so it cannot be spent
// twice; a rejection credits it back.
const requestWithdrawal = async (userId: string, payload: any) => {
  const amount = toMoney(Number(payload.amount));
  const minimum = Number(config.wallet.min_withdrawal);

  if (amount < minimum) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `The minimum withdrawal amount is ${minimum.toFixed(2)}.`,
    );
  }

  const withdrawal = await transaction(async (client) => {
    const result = await applyTransaction(client, {
      userId,
      type: "DEBIT",
      source: "WITHDRAWAL",
      amount,
      referenceType: "withdrawal",
      referenceId: null,
      description: `Withdrawal request via ${payload.method}`,
    });

    const created = await client.query(
      `
            INSERT INTO withdrawal_requests (
                user_id,
                wallet_id,
                amount,
                currency,
                method,
                account_details,
                "createdAt",
                "updatedAt"
            ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [
        userId,
        result.wallet.id,
        amount,
        result.wallet.currency,
        payload.method,
        JSON.stringify(payload.account_details || {}),
      ],
    );

    const request = created.rows[0];

    // Point the ledger row at the request now that it has an id
    await client.query(
      `
            UPDATE wallet_transactions
            SET reference_id = $1::uuid
            WHERE id = $2::uuid
        `,
      [request.id, result.transaction.id],
    );

    return request;
  });

  return withdrawal;
};

// My Withdrawals
const myWithdrawals = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const result = await query(
    `
        SELECT *
        FROM withdrawal_requests
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"WithdrawalStatus")
        ORDER BY "createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM withdrawal_requests
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"WithdrawalStatus")
    `,
    [userId, status],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    data: result.rows,
  };
};

// All withdrawals for admin
const allWithdrawalsForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const searchTerm = filters.searchTerm || null;

  const result = await query(
    `
        SELECT
            w.*,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar
            ) as user,
            (SELECT s.name FROM stores s WHERE s.owner_id = u.id) as store_name
        FROM withdrawal_requests w
        INNER JOIN users u ON w.user_id = u.id
        WHERE ($1::text IS NULL OR w.status = $1::"WithdrawalStatus")
            AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
        ORDER BY w."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [status, searchTerm, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM withdrawal_requests w
        INNER JOIN users u ON w.user_id = u.id
        WHERE ($1::text IS NULL OR w.status = $1::"WithdrawalStatus")
            AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
    `,
    [status, searchTerm],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    data: result.rows,
  };
};

// Approve, reject or settle a withdrawal
const updateWithdrawalStatus = async (
  adminId: string,
  withdrawalId: string,
  payload: any,
) => {
  const nextStatus = payload.status;

  const updated = await transaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM withdrawal_requests WHERE id = $1::uuid FOR UPDATE`,
      [withdrawalId],
    );

    if (locked.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Withdrawal request not found.");
    }

    const request = locked.rows[0];

    const allowed: Record<string, string[]> = {
      PENDING: ["APPROVED", "REJECTED"],
      APPROVED: ["PAID", "REJECTED"],
      REJECTED: [],
      PAID: [],
    };

    if (!(allowed[request.status] || []).includes(nextStatus)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `A ${request.status} withdrawal cannot be moved to ${nextStatus}.`,
      );
    }

    if (nextStatus === "REJECTED" && !payload.admin_note) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "A note is required when rejecting a withdrawal.",
      );
    }

    // Rejecting returns the money the request had already reserved
    if (nextStatus === "REJECTED") {
      await applyTransaction(client, {
        userId: request.user_id,
        type: "CREDIT",
        source: "WITHDRAWAL_REVERSAL",
        amount: Number(request.amount),
        referenceType: "withdrawal",
        referenceId: request.id,
        description: "Withdrawal request rejected",
      });
    }

    const result = await client.query(
      `
            UPDATE withdrawal_requests
            SET
                status = $1::"WithdrawalStatus",
                admin_note = COALESCE($2, admin_note),
                processed_by = $3::uuid,
                processed_at = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $4::uuid
            RETURNING *
        `,
      [nextStatus, payload.admin_note || null, adminId, withdrawalId],
    );

    return result.rows[0];
  });

  await enqueueNotifications({
    user_id: updated.user_id,
    type: "WITHDRAWAL_STATUS",
    title: `Withdrawal ${nextStatus.toLowerCase()}`,
    body:
      nextStatus === "REJECTED"
        ? `Your withdrawal of ${Number(updated.amount).toFixed(2)} was rejected and the amount is back in your wallet.`
        : `Your withdrawal of ${Number(updated.amount).toFixed(2)} is now ${nextStatus.toLowerCase()}.`,
    data: { withdrawal_id: updated.id, status: nextStatus },
  });

  return updated;
};

// Admin credit or debit, for support corrections
const adminAdjustWallet = async (adminId: string, payload: any) => {
  const userResult = await query(`SELECT id, name FROM users WHERE id = $1::uuid`, [
    payload.user_id,
  ]);

  if (userResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found.");
  }

  const result = await transaction(async (client) =>
    applyTransaction(client, {
      userId: payload.user_id,
      type: payload.type,
      source: "ADMIN_ADJUSTMENT",
      amount: Number(payload.amount),
      referenceType: "admin",
      referenceId: adminId,
      description: payload.reason,
    }),
  );

  await enqueueNotifications({
    user_id: payload.user_id,
    type: "WALLET_CREDIT",
    title: payload.type === "CREDIT" ? "Wallet credited" : "Wallet debited",
    body: `${payload.type === "CREDIT" ? "Added" : "Deducted"} ${Number(payload.amount).toFixed(2)}: ${payload.reason}`,
    data: { amount: payload.amount, type: payload.type },
  });

  return result.transaction;
};

export const WalletService = {
  myWallet,
  myTransactions,
  requestWithdrawal,
  myWithdrawals,
  allWithdrawalsForAdmin,
  updateWithdrawalStatus,
  adminAdjustWallet,
  // Used by the order and payment modules
  getOrCreateWallet,
  applyTransaction,
  creditVendorEarning,
  refundOrderToWallet,
};

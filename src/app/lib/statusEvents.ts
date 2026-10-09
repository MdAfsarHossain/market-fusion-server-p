import { emitToAdmins, emitToUser } from "./chatGateway";

// Realtime status events for stores and products.
//
// Called after the database write has committed, and never throws: a missing
// socket layer must not fail the request that changed the status. Payloads
// carry only what a client needs to patch its own state, nothing private.
//
//   store:status    { store_id, owner_id, name, slug, status, rejection_reason, updated_at }
//   product:status  { product_id, store_id, owner_id, title, slug, status, rejection_reason, updated_at }
//
// The owner receives both on their personal room; every connected admin
// receives them on the admins room.

type StoreRow = {
  id: string;
  owner_id: string;
  name?: string | null;
  slug?: string | null;
  status: string;
  rejection_reason?: string | null;
  updatedAt?: Date | string | null;
};

type ProductRow = {
  id: string;
  store_id?: string | null;
  title?: string | null;
  slug?: string | null;
  status: string;
  rejection_reason?: string | null;
  updatedAt?: Date | string | null;
};

export const emitStoreStatus = (store: StoreRow, previousStatus?: string | null) => {
  const payload = {
    store_id: store.id,
    owner_id: store.owner_id,
    name: store.name ?? null,
    slug: store.slug ?? null,
    status: store.status,
    previous_status: previousStatus ?? null,
    rejection_reason: store.rejection_reason ?? null,
    updated_at: store.updatedAt ?? new Date().toISOString(),
  };

  emitToUser(store.owner_id, "store:status", payload);
  emitToAdmins("store:status", payload);
};

export const emitProductStatus = (
  product: ProductRow,
  ownerId: string,
  previousStatus?: string | null,
) => {
  const payload = {
    product_id: product.id,
    store_id: product.store_id ?? null,
    owner_id: ownerId,
    title: product.title ?? null,
    slug: product.slug ?? null,
    status: product.status,
    previous_status: previousStatus ?? null,
    rejection_reason: product.rejection_reason ?? null,
    updated_at: product.updatedAt ?? new Date().toISOString(),
  };

  emitToUser(ownerId, "product:status", payload);
  emitToAdmins("product:status", payload);
};

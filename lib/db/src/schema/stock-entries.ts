import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const stockEntriesTable = pgTable(
  "stock_entries",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id"), // <-- Tambahan krusial untuk multi-tenant
    store: text("store").notNull(),
    transaction: text("transaction").notNull(),
    product: text("product").notNull(),
    quantity: integer("quantity").notNull().default(0),
    barcode: text("barcode"),
    displayQuantity: integer("display_quantity").notNull().default(0),
    secondaryDisplayQuantity: integer("secondary_display_quantity").notNull().default(0),
    warehouseQuantity: integer("warehouse_quantity").notNull().default(0),
    sourceType: text("source_type"), 
    sourceId: text("source_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    countedQuantity: integer("counted_quantity"),
    countedDisplayQuantity: integer("counted_display_quantity"),
    countedSecondaryDisplayQuantity: integer("counted_secondary_display_quantity"),
    countedWarehouseQuantity: integer("counted_warehouse_quantity"),
    syncStatus: text("sync_status").default("local"),
    syncError: text("sync_error"),
  },
  (table) => ({
    sourceUniqueIndex: uniqueIndex("stock_entries_source_unique").on(table.sourceType, table.sourceId),
    storeBarcodeIndex: index("stock_entries_store_barcode_idx").on(table.store, table.barcode),
    occurredAtIndex: index("stock_entries_occurred_at_idx").on(table.occurredAt),
  }),
);

export type StockEntry = typeof stockEntriesTable.$inferSelect;
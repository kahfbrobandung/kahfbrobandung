import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const stockEntriesTable = pgTable(
  "stock_entries",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    store: text("store").notNull(),
    transaction: text("transaction").notNull(),
    product: text("product").notNull(),
    quantity: integer("quantity").notNull(),
    barcode: text("barcode").notNull(),
    displayQuantity: integer("display_quantity").notNull().default(0),
    secondaryDisplayQuantity: integer("secondary_display_quantity").notNull().default(0),
    warehouseQuantity: integer("warehouse_quantity").notNull().default(0),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: text("source_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    countedQuantity: integer("counted_quantity"),
    countedDisplayQuantity: integer("counted_display_quantity"),
    countedSecondaryDisplayQuantity: integer("counted_secondary_display_quantity"),
    countedWarehouseQuantity: integer("counted_warehouse_quantity"),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (table) => ({
    clientIdUniqueIndex: uniqueIndex("stock_entries_client_id_unique").on(table.clientId),
    sourceUniqueIndex: uniqueIndex("stock_entries_source_unique").on(table.sourceType, table.sourceId),
  }),
);

export type StockEntry = typeof stockEntriesTable.$inferSelect;
export type NewStockEntry = typeof stockEntriesTable.$inferInsert;
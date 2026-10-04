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
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (table) => ({
    clientIdUniqueIndex: uniqueIndex("stock_entries_client_id_unique").on(table.clientId),
  }),
);

export type StockEntry = typeof stockEntriesTable.$inferSelect;
export type NewStockEntry = typeof stockEntriesTable.$inferInsert;
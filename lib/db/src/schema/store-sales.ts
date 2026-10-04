import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const storesTable = pgTable(
  "stores",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    normalizedNameUniqueIndex: uniqueIndex("stores_normalized_name_unique").on(
      table.normalizedName,
    ),
  }),
);

export const stockVisitsTable = pgTable(
  "stock_visits",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    storeId: integer("store_id")
      .notNull()
      .references(() => storesTable.id, { onDelete: "restrict" }),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdUniqueIndex: uniqueIndex("stock_visits_client_id_unique").on(table.clientId),
    storeVisitedAtIndex: index("stock_visits_store_visited_at_idx").on(
      table.storeId,
      table.visitedAt,
    ),
  }),
);

export const stocktakeLinesTable = pgTable(
  "stocktake_lines",
  {
    id: serial("id").primaryKey(),
    visitId: integer("visit_id")
      .notNull()
      .references(() => stockVisitsTable.id, { onDelete: "cascade" }),
    product: text("product").notNull(),
    barcode: text("barcode").notNull(),
    displayQuantity: integer("display_quantity").notNull().default(0),
    secondaryDisplayQuantity: integer("secondary_display_quantity").notNull().default(0),
    warehouseQuantity: integer("warehouse_quantity").notNull().default(0),
    totalQuantity: integer("total_quantity").notNull(),
  },
  (table) => ({
    visitBarcodeUniqueIndex: uniqueIndex("stocktake_lines_visit_barcode_unique").on(
      table.visitId,
      table.barcode,
    ),
    barcodeIndex: index("stocktake_lines_barcode_idx").on(table.barcode),
  }),
);

export const stockRestocksTable = pgTable(
  "stock_restocks",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    storeId: integer("store_id")
      .notNull()
      .references(() => storesTable.id, { onDelete: "restrict" }),
    product: text("product").notNull(),
    barcode: text("barcode").notNull(),
    quantity: integer("quantity").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    note: text("note"),
    invoiceNumber: text("invoice_number"),
    invoiceQuantity: integer("invoice_quantity"),
    invoiceDate: date("invoice_date", { mode: "string" }),
    invoiceRecordedAt: timestamp("invoice_recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdUniqueIndex: uniqueIndex("stock_restocks_client_id_unique").on(table.clientId),
    storeReceivedAtIndex: index("stock_restocks_store_received_at_idx").on(
      table.storeId,
      table.receivedAt,
    ),
    storeBarcodeReceivedAtIndex: index("stock_restocks_store_barcode_received_at_idx").on(
      table.storeId,
      table.barcode,
      table.receivedAt,
    ),
  }),
);

export type Store = typeof storesTable.$inferSelect;
export type StockVisit = typeof stockVisitsTable.$inferSelect;
export type StocktakeLine = typeof stocktakeLinesTable.$inferSelect;
export type StockRestock = typeof stockRestocksTable.$inferSelect;
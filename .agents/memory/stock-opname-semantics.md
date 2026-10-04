---
name: Stock opname semantics
description: Business rules for physical-count baselines, inferred sales, backdated stock, and invoice adjustments.
---

- Each physical stock visit establishes a new baseline for that store and SKU.
- Scanning is optional for existing and manually entered products, but every SKU must retain a stable barcode or product code shared by visits and restocks so records reconcile to the same item.
- For each interval, estimated sales equal the prior physical count plus incoming goods received in the interval plus signed stock-entry adjustments, minus the latest physical count.
- Attribute the interval's result to the date of the later visit in Jakarta time. Show both daily totals and per-visit detail. Keep manually recorded `Penjualan` visible separately, and do not persist derived sales as synthetic transactions.
- A backdated restock affects the interval containing its `receivedAt`, even when recorded later. The current balance starts from the latest physical count and includes only movements after that visit.
- When a late invoice is matched to a restock, apply only the quantity difference at invoice-recording time; do not add the full invoice quantity again.
- Keep the sales report as tables, not charts.

**Why:** These rules make physical counts authoritative, honor the date goods were actually received, prevent duplicated sales or stock movements, and keep manual products identifiable across stock events.

**How to apply:** Keep sales reports, stock balances, restock edits, and invoice reconciliation consistent with these rules. Allow product selection or manual entry without requiring a scanner, but preserve the same SKU key across records. Refresh affected calculations after stock changes.
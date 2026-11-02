import { db, storesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function normalizeStoreName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function displayStoreName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ");
}

export async function resolveStore(name: string) {
  const displayName = displayStoreName(name);
  const normalizedName = normalizeStoreName(displayName);
  await db
    .insert(storesTable)
    .values({ name: displayName, normalizedName })
    .onConflictDoNothing({ target: storesTable.normalizedName });

  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.normalizedName, normalizedName))
    .limit(1);
  return store;
}

export function iso(value: Date) {
  return new Date(value).toISOString();
}

export function jakartaStartOfDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const normalized = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  return normalized === value ? date : undefined;
}

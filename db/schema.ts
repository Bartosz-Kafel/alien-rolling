import { doublePrecision, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type ShopPurchases = {
  luck_boost: number;
  rolling_speed: number;
  money_increase: number;
};

export type Inventory = Record<string, number>;

export type PlacedAlien = {
  alien_id: string;
  last_collected: number;
} | null;

export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  usernameKey: text("username_key").notNull().unique(),
  password: text().notNull(),
  money: doublePrecision().notNull().default(50),
  totalRolls: integer("total_rolls").notNull().default(0),
  shopPurchases: jsonb("shop_purchases").$type<ShopPurchases>().notNull(),
  inventory: jsonb().$type<Inventory>().notNull(),
  placedAliens: jsonb("placed_aliens").$type<PlacedAlien[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

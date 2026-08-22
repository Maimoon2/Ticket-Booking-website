import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["CUSTOMER", "ORGANISER", "ADMIN"]);
export const eventCategoryEnum = pgEnum("event_category", ["MOVIE", "CONCERT"]);
export const seatCategoryEnum = pgEnum("seat_category", ["PREMIUM", "STANDARD"]);
export const eventSeatStatusEnum = pgEnum("event_seat_status", [
  "AVAILABLE",
  "HELD",
  "BOOKED",
  "OFFERED",
]);
export const bookingStatusEnum = pgEnum("booking_status", ["CONFIRMED", "CANCELLED"]);
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "WAITING",
  "OFFERED",
  "FULFILLED",
  "REMOVED",
]);
export const offerStatusEnum = pgEnum("offer_status", ["PENDING", "ACCEPTED", "EXPIRED"]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("CUSTOMER"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const venuesTable = pgTable("venues", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  address: text("address").notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  capacity: integer("capacity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const seatsTable = pgTable(
  "seats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
    row: varchar("row", { length: 8 }).notNull(),
    number: integer("number").notNull(),
    category: seatCategoryEnum("category").notNull().default("STANDARD"),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [uniqueIndex("seats_venue_row_number_idx").on(table.venueId, table.row, table.number)],
);

export const eventsTable = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organiserId: uuid("organiser_id").notNull().references(() => usersTable.id),
    venueId: uuid("venue_id").notNull().references(() => venuesTable.id),
    title: varchar("title", { length: 200 }).notNull(),
    category: eventCategoryEnum("category").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    premiumPrice: numeric("premium_price", { precision: 10, scale: 2 }).notNull(),
    standardPrice: numeric("standard_price", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("events_starts_at_idx").on(table.startsAt), index("events_category_idx").on(table.category)],
);

export const eventSeatsTable = pgTable(
  "event_seats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id").notNull().references(() => seatsTable.id, { onDelete: "cascade" }),
    status: eventSeatStatusEnum("status").notNull().default("AVAILABLE"),
    heldUntil: timestamp("held_until", { withTimezone: true }),
    holdId: uuid("hold_id"),
    offeredToWaitlistOfferId: uuid("offered_to_waitlist_offer_id"),
  },
  (table) => [
    uniqueIndex("event_seats_event_seat_idx").on(table.eventId, table.seatId),
    index("event_seats_status_idx").on(table.eventId, table.status),
  ],
);

export const seatHoldsTable = pgTable(
  "seat_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => usersTable.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("HELD"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("seat_holds_expiry_idx").on(table.status, table.expiresAt)],
);

export const bookingsTable = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reference: varchar("reference", { length: 32 }).notNull(),
    eventId: uuid("event_id").notNull().references(() => eventsTable.id),
    customerId: uuid("customer_id").notNull().references(() => usersTable.id),
    status: bookingStatusEnum("status").notNull().default("CONFIRMED"),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    qrData: text("qr_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("bookings_reference_idx").on(table.reference), index("bookings_customer_idx").on(table.customerId)],
);

export const bookingSeatsTable = pgTable(
  "booking_seats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
    eventSeatId: uuid("event_seat_id").notNull().references(() => eventSeatsTable.id),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [uniqueIndex("booking_seats_booking_event_seat_idx").on(table.bookingId, table.eventSeatId)],
);

export const waitlistTable = pgTable(
  "waitlist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    category: seatCategoryEnum("category").notNull(),
    status: waitlistStatusEnum("status").notNull().default("WAITING"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_customer_event_category_idx").on(table.eventId, table.customerId, table.category),
    index("waitlist_order_idx").on(table.eventId, table.category, table.status, table.createdAt),
  ],
);

export const waitlistOffersTable = pgTable(
  "waitlist_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    waitlistId: uuid("waitlist_id").notNull().references(() => waitlistTable.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id").notNull().references(() => seatsTable.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: offerStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("waitlist_offers_expiry_idx").on(table.status, table.expiresAt)],
);

export const auditEventsTable = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => usersTable.id),
  action: varchar("action", { length: 80 }).notNull(),
  entityId: uuid("entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: text("metadata"),
});

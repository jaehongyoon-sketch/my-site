CREATE TABLE `linked_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_account_id` text,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`verification` text DEFAULT 'not_started' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "account_status" CHECK("linked_accounts"."status" IN ('unlinked','pending','active','restricted','closed')),
	CONSTRAINT "verification_status" CHECK("linked_accounts"."verification" IN ('not_started','pending','verified','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_scope` ON `linked_accounts` (`id`,`connection_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_external_account` ON `linked_accounts` (`connection_id`,`external_account_id`);--> statement-breakpoint
CREATE INDEX `idx_accounts_user` ON `linked_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_entries` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`cash_cents` integer NOT NULL,
	`buying_power_cents` integer NOT NULL,
	`withdrawable_cents` integer NOT NULL,
	`reserved_cents` integer NOT NULL,
	`provider_revision` integer NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `linked_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "balance_currency" CHECK("balance_snapshots"."currency" = 'USD'),
	CONSTRAINT "balance_cash" CHECK(typeof("balance_snapshots"."cash_cents") = 'integer' AND "balance_snapshots"."cash_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "balance_buying_power" CHECK(typeof("balance_snapshots"."buying_power_cents") = 'integer' AND "balance_snapshots"."buying_power_cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "balance_snapshots"."buying_power_cents" >= 0),
	CONSTRAINT "balance_withdrawable" CHECK(typeof("balance_snapshots"."withdrawable_cents") = 'integer' AND "balance_snapshots"."withdrawable_cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "balance_snapshots"."withdrawable_cents" >= 0),
	CONSTRAINT "balance_reserved" CHECK(typeof("balance_snapshots"."reserved_cents") = 'integer' AND "balance_snapshots"."reserved_cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "balance_snapshots"."reserved_cents" >= 0),
	CONSTRAINT "balance_revision" CHECK(typeof("balance_snapshots"."provider_revision") = 'integer' AND "balance_snapshots"."provider_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "balance_snapshots"."provider_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_balance_revision` ON `balance_snapshots` (`account_id`,`provider_revision`);--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`environment` text NOT NULL,
	`approval` text DEFAULT 'unapproved' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "connection_environment" CHECK("provider_connections"."environment" IN ('development','sandbox','live')),
	CONSTRAINT "connection_approval" CHECK("provider_connections"."approval" IN ('unapproved','testing','approved','suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_environment` ON `provider_connections` (`provider_id`,`environment`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_fill_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`fee_cents` integer NOT NULL,
	`executed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`,`account_id`,`connection_id`) REFERENCES `orders`(`id`,`account_id`,`connection_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fill_quantity" CHECK(typeof("fills"."quantity") = 'integer' AND "fills"."quantity" BETWEEN 1 AND 10000),
	CONSTRAINT "fill_price" CHECK(typeof("fills"."price_cents") = 'integer' AND "fills"."price_cents" BETWEEN 1 AND 99),
	CONSTRAINT "fill_fee" CHECK(typeof("fills"."fee_cents") = 'integer' AND "fills"."fee_cents" BETWEEN -9007199254740991 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fill_external` ON `fills` (`connection_id`,`account_id`,`external_fill_id`);--> statement-breakpoint
CREATE INDEX `idx_fills_order` ON `fills` (`order_id`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_market_id` text NOT NULL,
	`title` text NOT NULL,
	`rules_version` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instrument_status" CHECK("instruments"."status" IN ('open','halted','closed','resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_instrument_external` ON `instruments` (`connection_id`,`external_market_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_instrument_scope` ON `instruments` (`id`,`connection_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`market_id` text NOT NULL,
	`external_order_id` text,
	`client_order_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`side` text NOT NULL,
	`outcome` text NOT NULL,
	`quantity` integer NOT NULL,
	`limit_price_cents` integer NOT NULL,
	`filled_quantity` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'submitting' NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`provider_revision` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`,`connection_id`,`user_id`) REFERENCES `linked_accounts`(`id`,`connection_id`,`user_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`market_id`,`connection_id`) REFERENCES `instruments`(`id`,`connection_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_side" CHECK("orders"."side" IN ('buy','sell')),
	CONSTRAINT "order_outcome" CHECK("orders"."outcome" IN ('yes','no')),
	CONSTRAINT "order_quantity" CHECK(typeof("orders"."quantity") = 'integer' AND "orders"."quantity" BETWEEN 1 AND 10000),
	CONSTRAINT "order_price" CHECK(typeof("orders"."limit_price_cents") = 'integer' AND "orders"."limit_price_cents" BETWEEN 1 AND 99),
	CONSTRAINT "order_filled_quantity" CHECK(typeof("orders"."filled_quantity") = 'integer' AND "orders"."filled_quantity" BETWEEN 0 AND "orders"."quantity"),
	CONSTRAINT "order_status" CHECK("orders"."status" IN ('submitting','unknown','accepted','partially_filled','filled','canceled','rejected','expired')),
	CONSTRAINT "order_cancel_boolean" CHECK("orders"."cancel_requested" IN (0,1)),
	CONSTRAINT "order_revision" CHECK("orders"."provider_revision" IS NULL OR (typeof("orders"."provider_revision") = 'integer' AND "orders"."provider_revision" BETWEEN 1 AND 9007199254740991)),
	CONSTRAINT "order_status_quantity" CHECK(("orders"."status" IN ('submitting','unknown','accepted','rejected') AND "orders"."filled_quantity" = 0) OR ("orders"."status" = 'partially_filled' AND "orders"."filled_quantity" > 0 AND "orders"."filled_quantity" < "orders"."quantity") OR ("orders"."status" = 'filled' AND "orders"."filled_quantity" = "orders"."quantity") OR ("orders"."status" IN ('canceled','expired') AND "orders"."filled_quantity" < "orders"."quantity")),
	CONSTRAINT "order_terminal_cancel" CHECK("orders"."status" NOT IN ('filled','canceled','rejected','expired') OR "orders"."cancel_requested" = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_scope` ON `orders` (`id`,`account_id`,`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_request` ON `orders` (`account_id`,`client_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_external` ON `orders` (`connection_id`,`account_id`,`external_order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_user_created` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `position_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`market_id` text NOT NULL,
	`outcome` text NOT NULL,
	`quantity` integer NOT NULL,
	`reserved_quantity` integer NOT NULL,
	`provider_revision` integer NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`account_id`,`connection_id`,`user_id`) REFERENCES `linked_accounts`(`id`,`connection_id`,`user_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`market_id`,`connection_id`) REFERENCES `instruments`(`id`,`connection_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "position_outcome" CHECK("position_snapshots"."outcome" IN ('yes','no')),
	CONSTRAINT "position_quantity" CHECK(typeof("position_snapshots"."quantity") = 'integer' AND "position_snapshots"."quantity" BETWEEN -9007199254740991 AND 9007199254740991 AND "position_snapshots"."quantity" >= 0),
	CONSTRAINT "position_reserved" CHECK(typeof("position_snapshots"."reserved_quantity") = 'integer' AND "position_snapshots"."reserved_quantity" BETWEEN -9007199254740991 AND 9007199254740991 AND "position_snapshots"."reserved_quantity" BETWEEN 0 AND "position_snapshots"."quantity"),
	CONSTRAINT "position_revision" CHECK(typeof("position_snapshots"."provider_revision") = 'integer' AND "position_snapshots"."provider_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "position_snapshots"."provider_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_position_revision` ON `position_snapshots` (`account_id`,`market_id`,`outcome`,`provider_revision`);--> statement-breakpoint
CREATE TABLE `provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`normalized_payload` text NOT NULL,
	`processing_status` text DEFAULT 'received' NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_processing_status" CHECK("provider_events"."processing_status" IN ('received','applied','quarantined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_event` ON `provider_events` (`connection_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_events_processing` ON `provider_events` (`processing_status`,`received_at`);--> statement-breakpoint
CREATE TABLE `cash_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`client_transfer_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`external_transfer_id` text,
	`direction` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`provider_revision` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`,`connection_id`,`user_id`) REFERENCES `linked_accounts`(`id`,`connection_id`,`user_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfer_amount" CHECK(typeof("cash_transfers"."amount_cents") = 'integer' AND "cash_transfers"."amount_cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "cash_transfers"."amount_cents" > 0),
	CONSTRAINT "transfer_currency" CHECK("cash_transfers"."currency" = 'USD'),
	CONSTRAINT "transfer_direction" CHECK("cash_transfers"."direction" IN ('deposit','withdrawal')),
	CONSTRAINT "transfer_status" CHECK("cash_transfers"."status" IN ('requested','unknown','pending','completed','failed','canceled','returned')),
	CONSTRAINT "transfer_revision" CHECK("cash_transfers"."provider_revision" IS NULL OR (typeof("cash_transfers"."provider_revision") = 'integer' AND "cash_transfers"."provider_revision" BETWEEN 1 AND 9007199254740991))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transfer_request` ON `cash_transfers` (`account_id`,`client_transfer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transfer_external` ON `cash_transfers` (`connection_id`,`account_id`,`external_transfer_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_user_created` ON `cash_transfers` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "user_status" CHECK("app_users"."status" IN ('active','suspended','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_auth_subject` ON `app_users` (`auth_subject`);
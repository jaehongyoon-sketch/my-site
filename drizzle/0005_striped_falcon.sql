CREATE TABLE `practice_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text,
	`kind` text NOT NULL,
	`available_delta` integer NOT NULL,
	`reserved_delta` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `practice_wallets`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_ledger_kind" CHECK("practice_ledger"."kind" IN ('grant','reserve','release'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_ledger_order_kind` ON `practice_ledger` (`order_id`,`kind`);--> statement-breakpoint
CREATE TABLE `practice_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`client_id` text NOT NULL,
	`intent_json` text NOT NULL,
	`event_revision` integer NOT NULL,
	`event_title` text NOT NULL,
	`outcome` text NOT NULL,
	`price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`principal_cents` integer NOT NULL,
	`fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`release_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `practice_wallets`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_order_terms" CHECK("practice_orders"."outcome" IN ('yes','no') AND "practice_orders"."status" IN ('open','expired','voided') AND "practice_orders"."price_cents" BETWEEN 1 AND 99 AND "practice_orders"."quantity" BETWEEN 1 AND 10000 AND "practice_orders"."principal_cents"="practice_orders"."price_cents"*"practice_orders"."quantity" AND "practice_orders"."fee_cents"=CAST(("practice_orders"."principal_cents"+200)/400 AS INTEGER) AND "practice_orders"."total_cents"="practice_orders"."principal_cents"+"practice_orders"."fee_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_order_idempotency` ON `practice_orders` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `practice_order_history` ON `practice_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`available_cents` integer NOT NULL,
	`reserved_cents` integer NOT NULL,
	`grant_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_wallet_nonnegative" CHECK(typeof("practice_wallets"."available_cents")='integer' AND typeof("practice_wallets"."reserved_cents")='integer' AND "practice_wallets"."available_cents">=0 AND "practice_wallets"."reserved_cents">=0 AND "practice_wallets"."available_cents"+"practice_wallets"."reserved_cents"=100000)
);

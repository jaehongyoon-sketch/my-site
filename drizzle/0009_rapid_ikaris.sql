CREATE TABLE `practice_sell_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`client_id` text NOT NULL,
	`intent_json` text NOT NULL,
	`event_revision` integer NOT NULL,
	`event_title` text NOT NULL,
	`outcome` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text,
	`release_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_sell_terms" CHECK("practice_sell_orders"."quantity" BETWEEN 1 AND 10000 AND "practice_sell_orders"."price_cents" BETWEEN 1 AND 99 AND "practice_sell_orders"."outcome" IN ('yes','no') AND "practice_sell_orders"."status" IN ('open','cancelled','expired','voided'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_sell_idempotency` ON `practice_sell_orders` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `practice_sell_position` ON `practice_sell_orders` (`user_id`,`event_id`,`outcome`,`status`);--> statement-breakpoint
CREATE INDEX `practice_sell_history` ON `practice_sell_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_share_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`sell_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`reserved_delta` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sell_id`) REFERENCES `practice_sell_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_share_direction" CHECK(("practice_share_entries"."kind"='reserve' AND "practice_share_entries"."reserved_delta">0) OR ("practice_share_entries"."kind"='release' AND "practice_share_entries"."reserved_delta"<0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_share_once` ON `practice_share_entries` (`sell_id`,`kind`);
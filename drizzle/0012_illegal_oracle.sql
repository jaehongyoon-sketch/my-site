CREATE TABLE `practice_trade_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_title` text NOT NULL,
	`outcome` text NOT NULL,
	`quantity` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_trade_event_terms" CHECK("practice_trade_events"."kind" IN ('buy_accepted','buy_filled','buy_released','sell_reserved','sell_released') AND "practice_trade_events"."quantity">0 AND "practice_trade_events"."outcome" IN ('yes','no'))
);
--> statement-breakpoint
CREATE INDEX `practice_trade_events_user_time` ON `practice_trade_events` (`user_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_trade_events_source` ON `practice_trade_events` (`user_id`,`kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `practice_trade_receipts` (
	`event_id` text PRIMARY KEY NOT NULL,
	`handler` text NOT NULL,
	`processed_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `practice_trade_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_trade_handler" CHECK("practice_trade_receipts"."handler"='activity-v1')
);

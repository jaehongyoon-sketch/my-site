CREATE TABLE `practice_cash` (
	`user_id` text PRIMARY KEY NOT NULL,
	`available_units` integer NOT NULL,
	`reserved_units` integer NOT NULL,
	`spent_units` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `practice_wallets`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_cash_conserved" CHECK(typeof("practice_cash"."available_units")='integer' AND typeof("practice_cash"."reserved_units")='integer' AND typeof("practice_cash"."spent_units")='integer' AND "practice_cash"."available_units">=0 AND "practice_cash"."reserved_units">=0 AND "practice_cash"."spent_units">=0 AND "practice_cash"."available_units"+"practice_cash"."reserved_units"+"practice_cash"."spent_units"=40000000)
);
--> statement-breakpoint
CREATE TABLE `practice_cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text,
	`kind` text NOT NULL,
	`available_delta_units` integer NOT NULL,
	`reserved_delta_units` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `practice_cash`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_cash_entry_kind" CHECK("practice_cash_entries"."kind" IN ('grant','reserve','release'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_cash_entry_order_kind` ON `practice_cash_entries` (`order_id`,`kind`);--> statement-breakpoint
CREATE TABLE `practice_match_entries` (
	`match_id` text NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`principal_units` integer NOT NULL,
	`fee_units` integer NOT NULL,
	`released_units` integer NOT NULL,
	`reserved_debit_units` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `practice_matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `practice_cash`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_entry_conservation" CHECK("practice_match_entries"."principal_units">0 AND "practice_match_entries"."fee_units">=0 AND "practice_match_entries"."released_units">=0 AND "practice_match_entries"."reserved_debit_units"="practice_match_entries"."principal_units"+"practice_match_entries"."fee_units"+"practice_match_entries"."released_units")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_entry_match_order` ON `practice_match_entries` (`match_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `practice_entry_user` ON `practice_match_entries` (`user_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `practice_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`maker_id` text NOT NULL,
	`taker_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`maker_price` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maker_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taker_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_match_terms" CHECK("practice_matches"."quantity">0 AND "practice_matches"."maker_price" BETWEEN 1 AND 99 AND "practice_matches"."maker_id"<>"practice_matches"."taker_id")
);
--> statement-breakpoint
CREATE INDEX `practice_match_event` ON `practice_matches` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_order_progress` (
 `fee_policy` text DEFAULT 'per_contract' NOT NULL,
	`order_id` text PRIMARY KEY NOT NULL,
	`filled_quantity` integer DEFAULT 0 NOT NULL,
	`executed_principal_units` integer DEFAULT 0 NOT NULL,
	`charged_fee_units` integer DEFAULT 0 NOT NULL,
	`held_units` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_progress_nonnegative" CHECK("practice_order_progress"."filled_quantity">=0 AND "practice_order_progress"."executed_principal_units">=0 AND "practice_order_progress"."charged_fee_units">=0 AND "practice_order_progress"."held_units">=0 AND "practice_order_progress"."revision">=0)
);

--> statement-breakpoint
-- Preserve existing Day 10 balances and agreed fee policy. No cancellation, regrant or transfer.
INSERT INTO practice_cash SELECT user_id,available_cents*400,reserved_cents*400,0 FROM practice_wallets;
--> statement-breakpoint
INSERT INTO practice_cash_entries SELECT id,user_id,order_id,kind,available_delta*400,reserved_delta*400,created_at FROM practice_ledger;
--> statement-breakpoint
INSERT INTO practice_order_progress (order_id,fee_policy,filled_quantity,executed_principal_units,charged_fee_units,held_units,revision)
SELECT id,'legacy_order',0,0,0,CASE WHEN status='open' THEN total_cents*400 ELSE 0 END,0 FROM practice_orders;

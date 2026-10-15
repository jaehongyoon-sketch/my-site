CREATE TABLE `trading_restrictions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`blocked` integer NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trading_restriction_values" CHECK("trading_restrictions"."blocked" IN (0,1) AND "trading_restrictions"."revision">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trading_restriction_operation` ON `trading_restrictions` (`operation_id`);
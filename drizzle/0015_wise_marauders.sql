CREATE TABLE `notification_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_settings_terms" CHECK("notification_settings"."enabled" IN (0,1) AND "notification_settings"."revision">0)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`visible` integer NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `practice_trade_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_visible" CHECK("notifications"."visible" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `notifications_user_time` ON `notifications` (`user_id`,`created_at`,`id`);
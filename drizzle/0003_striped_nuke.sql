CREATE TABLE `watchlist_entries` (
	`user_id` text NOT NULL,
	`market_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_watchlist_user_market` ON `watchlist_entries` (`user_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_user_created` ON `watchlist_entries` (`user_id`,`created_at`);
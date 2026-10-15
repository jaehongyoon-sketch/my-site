CREATE TABLE `google_auth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_google_flows_expiry` ON `google_auth_flows` (`expires_at`);--> statement-breakpoint
CREATE TABLE `google_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`google_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_google_sessions_expiry` ON `google_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_google_sessions_subject` ON `google_sessions` (`google_subject`);
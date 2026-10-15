CREATE TABLE `name_change_limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name_hash` text NOT NULL,
	`changed_at` integer NOT NULL,
	`operation_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `own_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`rules` text NOT NULL,
	`source_url` text NOT NULL,
	`closes_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "own_event_status" CHECK("own_events"."status" IN ('draft','published','archived')),
	CONSTRAINT "own_event_revision" CHECK("own_events"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_own_events_status_close` ON `own_events` (`status`,`closes_at`,`id`);
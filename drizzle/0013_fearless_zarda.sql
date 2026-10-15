CREATE TABLE `event_resolutions` (
	`event_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`event_revision` integer NOT NULL,
	`status` text NOT NULL,
	`outcome` text NOT NULL,
	`evidence_url` text NOT NULL,
	`rationale` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`operation_id` text NOT NULL,
	`proposed_by` text NOT NULL,
	`proposed_at` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_resolution_terms" CHECK("event_resolutions"."revision">0 AND "event_resolutions"."status" IN ('proposed','final') AND "event_resolutions"."outcome" IN ('yes','no','void') AND (("event_resolutions"."status"='proposed' AND "event_resolutions"."confirmed_at" IS NULL AND "event_resolutions"."confirmed_by" IS NULL) OR ("event_resolutions"."status"='final' AND "event_resolutions"."confirmed_at" IS NOT NULL AND "event_resolutions"."confirmed_by" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_resolution_operation` ON `event_resolutions` (`operation_id`);--> statement-breakpoint
CREATE TABLE `resolution_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`intent_json` text NOT NULL,
	`resolution_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `own_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resolution_actions_event_time` ON `resolution_actions` (`event_id`,`created_at`);
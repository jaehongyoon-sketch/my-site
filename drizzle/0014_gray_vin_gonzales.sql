CREATE TABLE `practice_control` (
	`id` text PRIMARY KEY NOT NULL,
	`paused` integer NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_control_terms" CHECK("practice_control"."id"='global' AND "practice_control"."paused" IN (0,1) AND "practice_control"."revision">0)
);

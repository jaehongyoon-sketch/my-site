CREATE TABLE `app_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "profile_name_length" CHECK(length("app_profiles"."display_name") <= 60)
);

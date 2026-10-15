CREATE TABLE `practice_cancellations` (
	`order_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`cancelled_quantity` integer NOT NULL,
	`refunded_units` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `practice_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `practice_cash`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_cancel_amounts" CHECK("practice_cancellations"."cancelled_quantity">0 AND "practice_cancellations"."refunded_units">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_cancel_operation` ON `practice_cancellations` (`operation_id`);
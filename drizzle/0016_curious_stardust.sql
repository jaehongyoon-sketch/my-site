CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "request_limit_positive" CHECK("request_limits"."count">0 AND "request_limits"."window_start">=0)
);

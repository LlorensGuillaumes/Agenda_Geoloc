CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`password` text,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `alarms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`trigger_type` text NOT NULL,
	`time_config` text,
	`location_config` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_fired_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`addressee_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`trust_level` text DEFAULT 'manual_accept' NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_pair_unique` ON `friendships` (`requester_id`,`addressee_id`);--> statement-breakpoint
CREATE TABLE `place_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`shared_with_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `place_shares_unique` ON `place_shares` (`place_id`,`shared_with_user_id`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`radius_meters` integer DEFAULT 150 NOT NULL,
	`icon` text DEFAULT 'pin',
	`color` text DEFAULT '#3B82F6',
	`address` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`pushToken` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);

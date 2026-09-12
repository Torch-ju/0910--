CREATE TABLE `story_revisions` (
	`story` text NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`story`, `version`)
);
--> statement-breakpoint
CREATE TABLE `story_runs` (
	`story` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`journal` text DEFAULT '{}' NOT NULL,
	`error` text,
	`updated` integer NOT NULL,
	PRIMARY KEY(`story`, `id`)
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`updated` integer NOT NULL,
	`lock` text,
	`lease` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_owner_updated` ON `stories` (`owner`,`updated`);
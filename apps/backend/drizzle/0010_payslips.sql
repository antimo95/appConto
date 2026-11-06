CREATE TABLE `payslip_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payslip_id` text NOT NULL,
	`position` integer NOT NULL,
	`code` text,
	`description` text NOT NULL,
	`section` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`quantity` real,
	`unit` text,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_items_payslip_id_idx` ON `payslip_items` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslip_leave_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`payslip_id` text NOT NULL,
	`type` text NOT NULL,
	`accrued` real NOT NULL,
	`used` real NOT NULL,
	`remaining` real NOT NULL,
	`unit` text NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslip_leave_balances_payslip_type_unique` ON `payslip_leave_balances` (`payslip_id`,`type`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`employer` text,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`stored_path` text NOT NULL,
	`imported_at` text NOT NULL,
	`parser_id` text NOT NULL,
	`total_earnings_cents` integer NOT NULL,
	`total_deductions_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`rounding_cents` integer,
	`taxable_inps_cents` integer,
	`taxable_irpef_cents` integer,
	`worked_hours` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_period_unique` ON `payslips` (`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_sha256_unique` ON `payslips` (`sha256`);
DROP INDEX `payslips_period_unique`;--> statement-breakpoint
ALTER TABLE `payslips` ADD `kind` text DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_period_kind_unique` ON `payslips` (`period`,`kind`);
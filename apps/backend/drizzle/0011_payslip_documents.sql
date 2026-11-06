CREATE TABLE `payslip_documents` (
	`payslip_id` text PRIMARY KEY NOT NULL,
	`content` blob NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `payslips` DROP COLUMN `stored_path`;
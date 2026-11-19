ALTER TABLE "coordinator_goal_steps" DROP CONSTRAINT "coordinator_goal_steps_kind_check";--> statement-breakpoint
ALTER TABLE "coordinator_goals" DROP CONSTRAINT "coordinator_goals_kind_check";--> statement-breakpoint
ALTER TABLE "coordinator_goal_steps" ADD CONSTRAINT "coordinator_goal_steps_kind_check" CHECK ("coordinator_goal_steps"."kind" in ('research', 'poll', 'planning', 'plan_action', 'outreach'));--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_kind_check" CHECK ("coordinator_goals"."kind" in ('research', 'poll', 'planning', 'plan_action', 'participant', 'book'));

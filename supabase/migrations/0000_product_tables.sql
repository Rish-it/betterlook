CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"ui_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_id_ui_id_unique" UNIQUE("conversation_id","ui_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sandbox_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_sandbox_id_unique" UNIQUE("sandbox_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_project_id_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_id_idx" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "projects_owner_id_idx" ON "projects" USING btree ("owner_id");
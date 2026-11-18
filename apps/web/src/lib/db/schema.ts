import {bigint, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid} from 'drizzle-orm/pg-core';
import {authUsers} from 'drizzle-orm/supabase';
import type {AgentMessage, AgentMetadata, Usage} from '@/lib/agent/types';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().references(() => authUsers.id, {onDelete: 'cascade'}),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}).enableRLS();

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, {onDelete: 'cascade'}),
  name: text('name').notNull(),
  sandboxId: text('sandbox_id').unique(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [index('projects_owner_id_idx').on(table.ownerId)]).enableRLS();

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, {onDelete: 'cascade'}),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [index('conversations_project_id_idx').on(table.projectId)]).enableRLS();

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);

export const messages = pgTable('messages', {
  id: bigint('id', {mode: 'bigint'}).generatedAlwaysAsIdentity().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, {onDelete: 'cascade'}),
  uiId: text('ui_id').$type<AgentMessage['id']>().notNull(),
  role: messageRole('role').notNull(),
  parts: jsonb('parts').$type<AgentMessage['parts']>().notNull(),
  metadata: jsonb('metadata').$type<Pick<AgentMetadata, 'model' | 'notice'>>(),
  usage: jsonb('usage').$type<Usage>(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  index('messages_conversation_id_id_idx').on(table.conversationId, table.id),
  unique('messages_conversation_id_ui_id_unique').on(table.conversationId, table.uiId),
]).enableRLS();

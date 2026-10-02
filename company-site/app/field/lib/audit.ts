import type { AuditEvent } from "./types";

export interface CreateAuditEventInput {
  eventId: string;
  actorId: string;
  action: string;
  entityType: AuditEvent["entityType"];
  entityId: string;
  occurredAt: string;
  changes?: AuditEvent["changes"];
  requestId?: string;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id: input.eventId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: input.occurredAt,
  };

  if (input.changes) event.changes = input.changes;
  if (input.requestId) event.requestId = input.requestId;

  return Object.freeze(event);
}

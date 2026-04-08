import type { AuditLogRecord, CreateAuditLogInput } from "./audit-log.repository";
import { AuditLogRepository } from "./audit-log.repository";

export class AuditLogService {
  constructor(private readonly repository: AuditLogRepository) {}

  record(input: CreateAuditLogInput) {
    return this.repository.create(input);
  }

  listForActor(actorUserId: string, limit = 20): AuditLogRecord[] {
    return this.repository.listByActor(actorUserId, limit);
  }
}

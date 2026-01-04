export declare class SyncJobOrmEntity {
    id: string;
    jobType: string;
    connectionId: string;
    payloadJson: Record<string, unknown>;
    status: string;
    idempotencyKey: string;
    attempts: number;
    maxAttempts: number;
    nextRunAt: Date;
    lockedAt: Date | null;
    lockedBy: string | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=sync-job.orm-entity.d.ts.map
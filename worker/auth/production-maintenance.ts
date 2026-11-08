import { AuthMaintenanceStore, type AuthMaintenancePolicy } from './maintenance';

// Deployment installs this expression only on the dedicated production Worker.
export const AUTH_MAINTENANCE_CRON = '*/15 * * * *';
export const AUTH_MAINTENANCE_POLICY: Readonly<AuthMaintenancePolicy> = Object.freeze({
  expiredGraceMs: 24 * 60 * 60 * 1000,
  minimumIntervalMs: 15 * 60 * 1000,
  batchLimit: 100,
});

/** Server-only, single bounded run. No request input or immediate retry. */
export async function runProductionAuthMaintenance(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const result = await new AuthMaintenanceStore(db, origin, AUTH_MAINTENANCE_POLICY, clock).run();
  // Project every count explicitly; never log storage rows, origin, or caught values.
  const summary =
    result.kind === 'completed' &&
    Object.values(result.deleted).every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 100)
      ? {
          event: 'auth_maintenance' as const,
          outcome: 'completed' as const,
          deleted: {
            attempts: result.deleted.attempts,
            commands: result.deleted.commands,
            sessions: result.deleted.sessions,
            contexts: result.deleted.contexts,
            subjectFloors: result.deleted.subjectFloors,
          },
        }
      : {
          event: 'auth_maintenance' as const,
          outcome: result.kind === 'throttled' ? ('throttled' as const) : ('unavailable' as const),
        };
  console.info(JSON.stringify(summary));
  return summary;
}

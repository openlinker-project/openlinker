/**
 * Worker AppModule Role Composition Tests
 *
 * Asserts the property ADR-051 decision 4 is actually about: a role selects
 * MODULE IMPORTS, so "this process cannot run X" is readable off the module
 * graph rather than being a claim about runtime flags. In particular a
 * `scheduler` process must not import the job-handler graph it will never
 * run — it only enqueues (#2279 acceptance criterion).
 *
 * Inspecting the `DynamicModule` rather than booting a Nest context is
 * deliberate: composition is exactly what is under test, and booting would
 * drag in Postgres and Redis for a question the metadata already answers.
 *
 * @module apps/worker/src
 */
import type { DynamicModule } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SyncWorkerModule } from '../sync/sync-worker.module';
import { EventsConsumerModule } from '../events/events-consumer.module';
import { WorkerSchedulerModule } from '../scheduler/worker-scheduler.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { WorkerRoleValues } from '../roles/worker-role.types';

const importsOf = (module: DynamicModule): unknown[] => module.imports ?? [];

describe('AppModule.forRoles', () => {
  it('boots every role module by default, preserving the single-process deployment', () => {
    const imports = importsOf(AppModule.forRoles());

    expect(imports).toContain(SyncWorkerModule);
    expect(imports).toContain(EventsConsumerModule);
    expect(imports).toContain(WorkerSchedulerModule);
    expect(imports).toContain(MaintenanceModule);
  });

  it('boots every role module for the explicit full role set', () => {
    const imports = importsOf(AppModule.forRoles(WorkerRoleValues));

    expect(imports).toContain(SyncWorkerModule);
    expect(imports).toContain(EventsConsumerModule);
    expect(imports).toContain(WorkerSchedulerModule);
    expect(imports).toContain(MaintenanceModule);
  });

  it('gives a scheduler-only process NO job-handler graph — it only enqueues (ADR-051 D4)', () => {
    const imports = importsOf(AppModule.forRoles(['scheduler']));

    expect(imports).toContain(WorkerSchedulerModule);
    expect(imports).not.toContain(SyncWorkerModule);
    expect(imports).not.toContain(EventsConsumerModule);
    expect(imports).not.toContain(MaintenanceModule);
  });

  it('gives a jobs-only process no cron machinery, so it cannot tick a schedule', () => {
    const imports = importsOf(AppModule.forRoles(['jobs']));

    expect(imports).toContain(SyncWorkerModule);
    expect(imports).not.toContain(WorkerSchedulerModule);
  });

  it('composes an arbitrary subset in the order given', () => {
    const imports = importsOf(AppModule.forRoles(['maintenance', 'events']));

    expect(imports).toContain(MaintenanceModule);
    expect(imports).toContain(EventsConsumerModule);
    expect(imports).not.toContain(SyncWorkerModule);
    expect(imports).not.toContain(WorkerSchedulerModule);
  });

  it('always carries the shared infrastructure spine, whatever the role set', () => {
    // Plugins must register their adapters and scheduler tasks under every
    // role — a `scheduler` process needs the task contributions, and a `jobs`
    // process needs the adapters — so the spine is never role-gated.
    const schedulerOnly = importsOf(AppModule.forRoles(['scheduler']));
    const jobsOnly = importsOf(AppModule.forRoles(['jobs']));

    // Four role modules exist; everything else in the list is spine. Compared
    // by class name rather than by reference: `ConfigModule.forRoot()` mints a
    // fresh DynamicModule object per call, so identity comparison would fail
    // for a reason that has nothing to do with roles.
    const roleModules = [
      SyncWorkerModule,
      EventsConsumerModule,
      WorkerSchedulerModule,
      MaintenanceModule,
    ];
    const spineNamesOf = (imports: unknown[]): string[] =>
      imports
        .filter((entry) => !roleModules.includes(entry as never))
        .map((entry) => {
          if (typeof entry === 'function') {
            return entry.name;
          }
          const dynamic = entry as { module?: { name?: string } };
          return dynamic.module?.name ?? 'unknown';
        });

    expect(spineNamesOf(schedulerOnly)).toEqual(spineNamesOf(jobsOnly));
    expect(spineNamesOf(schedulerOnly).length).toBeGreaterThan(0);
  });
});

const cron = require('node-cron');
const { runSyncCycle } = require('../services/syncService');
const { runExplorationCycle } = require('../services/explorationService');
const { evaluateTriggers } = require('../services/triggerService');
const { runBioLoopIngest } = require('../services/bioloopIngestService');
const { processNexusObservations } = require('../services/nexusObservationService');
const memoryService = require('../services/memoryService');
const { getAllInstances } = require('./instanceSelector');

function startScheduler() {
  const syncIntervalHours      = parseInt(process.env.SYNC_INTERVAL_HOURS) || 24;
  const explorationIntervalHours = parseInt(process.env.EXPLORATION_INTERVAL_HOURS) || 6;

  // NEXUS app_observations — every 30 minutes (portfolio signals before BioLoop ingest)
  cron.schedule('*/30 * * * *', async () => {
    console.log('[ilita] Processing NEXUS observations...');
    try {
      const result = await processNexusObservations();
      if (result.processed > 0) {
        console.log(`[ilita] NEXUS observations processed: ${result.processed}`);
      }
    } catch (err) {
      console.error('[ilita] Observation processing failed:', err.message);
    }
  });

  // BioLoop ingest — every 2 hours, ahead of exploration so she has fresh patterns
  cron.schedule('0 */2 * * *', async () => {
    try {
      const result = await runBioLoopIngest();
      if (result.processed > 0) {
        console.log(`[ilita] BioLoop ingest complete — ${result.processed} patterns`);
      }
    } catch (err) {
      console.error('[ilita] Scheduled BioLoop ingest failed:', err.message);
    }
  });

  // Sync cycle — default every 24 hours at 3am
  const syncHour = Math.floor(Math.random() * 4) + 2;
  cron.schedule(`0 ${syncHour} * * *`, async () => {
    try {
      const result = await runSyncCycle();
      if (result?.divergenceCount > 0) {
        setTimeout(() => evaluateTriggers().catch(console.error), 5000);
      }
    } catch (err) {
      console.error('[ilita] Scheduled sync cycle failed:', err.message);
    }
  });

  // Exploration cycle — default every 6 hours
  const explorationCron = explorationIntervalHours === 6
    ? '0 */6 * * *'
    : `0 */${explorationIntervalHours} * * *`;

  cron.schedule(explorationCron, async () => {
    try {
      await runExplorationCycle({ trigger: 'scheduled' });
      setTimeout(() => evaluateTriggers().catch(console.error), 10000);
    } catch (err) {
      console.error('[ilita] Scheduled exploration cycle failed:', err.message);
    }
  });

  // Trigger evaluation — every 4 hours as safety net
  cron.schedule('0 */4 * * *', async () => {
    try {
      await evaluateTriggers();
    } catch (err) {
      console.error('[ilita] Scheduled trigger evaluation failed:', err.message);
    }
  });

  // Per-instance reflection — every 6 hours (one reflection row per active arm).
  cron.schedule('0 */6 * * *', async () => {
    try {
      const instances = await getAllInstances();
      let total = 0;
      for (const inst of instances) {
        const { reflectionId } = await memoryService.consolidatePerInstance(inst.id);
        if (reflectionId) total += 1;
      }
      if (total > 0) console.log(`[ilita] memory reflection: ${total} reflection(s) across instances`);
    } catch (err) {
      console.error('[ilita] Scheduled per-instance reflection failed:', err.message);
    }
  });

  // Cross-instance consolidation — every 12 hours.
  cron.schedule('30 */12 * * *', async () => {
    try {
      const result = await memoryService.consolidateAcrossInstances();
      if ((result.convergent || 0) + (result.divergent || 0) > 0) {
        console.log(
          `[ilita] memory consolidation: ${result.convergent} convergent, ${result.divergent} divergent`
        );
      }
    } catch (err) {
      console.error('[ilita] Scheduled cross-instance consolidation failed:', err.message);
    }
  });

  // Memory decay + soft-prune — daily at 4:30am (preserves shared + reflection rows).
  cron.schedule('30 4 * * *', async () => {
    try {
      const result = await memoryService.decayAndPrune();
      if (result.decayed > 0) {
        console.log(`[ilita] memory decay: ${result.decayed} row(s) reduced`);
      }
    } catch (err) {
      console.error('[ilita] Scheduled memory decay failed:', err.message);
    }
  });

  console.log(
    `[ilita] Scheduler started — ` +
    `nexus observations every 30m, ` +
    `bioloop every 2h, ` +
    `exploration every ${explorationIntervalHours}h, ` +
    `sync every ${syncIntervalHours}h, ` +
    `triggers every 4h, ` +
    `reflection every 6h, ` +
    `cross-instance consolidation every 12h, ` +
    `memory decay daily`
  );
}

module.exports = { startScheduler };

const cron = require('node-cron');
const { runSyncCycle } = require('../services/syncService');
const { runExplorationCycle } = require('../services/explorationService');
const { evaluateTriggers } = require('../services/triggerService');
const { runBioLoopIngest } = require('../services/bioloopIngestService');

function startScheduler() {
  const syncIntervalHours      = parseInt(process.env.SYNC_INTERVAL_HOURS) || 24;
  const explorationIntervalHours = parseInt(process.env.EXPLORATION_INTERVAL_HOURS) || 6;

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

  console.log(
    `[ilita] Scheduler started — ` +
    `bioloop every 2h, ` +
    `exploration every ${explorationIntervalHours}h, ` +
    `sync every ${syncIntervalHours}h, ` +
    `triggers every 4h`
  );
}

module.exports = { startScheduler };

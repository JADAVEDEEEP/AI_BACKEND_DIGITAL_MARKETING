require('dotenv').config();
const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { initRepository } = require('./repositories');
const { createDiscoveryService } = require('./Services/discovery');

const PORT = process.env.PORT || 3000;

async function start() {
    const app = createApp();

    // Discovery pipeline: storage + background job runner
    const repo = await initRepository();
    const { runner } = createDiscoveryService({ repo });
    if (config.jobs.enabled) runner.start();

    const server = app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });

    const shutdown = async (signal) => {
        logger.info('server.shutdown', { signal });
        server.close();
        await runner.stop().catch(() => {});
        await require('./config/database').disconnectDatabase().catch(() => {});
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (err) => logger.error('process.unhandled_rejection', { error: err }));
}

start().catch((err) => {
    logger.error('server.start_failed', { error: err });
    process.exit(1);
});

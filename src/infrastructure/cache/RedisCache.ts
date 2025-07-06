import { createClient } from 'redis';
import type { Logger } from 'src/application/ports/output';

export async function initRedisClient(logger: Logger): Promise<ReturnType<typeof createClient>> {
	const redisHost = process.env.REDIS_HOST || '127.0.0.1';
	const redisPort = process.env.REDIS_PORT || '6379';
	const redisPassword = process.env.REDIS_PASSWORD || '';
	const redisDBIndex = parseInt(process.env.REDIS_DBINDEX ?? '0', 10);
	const redisUrl = `redis://${redisHost}:${redisPort}`;

	const client = createClient({
		url: redisUrl,
		password: redisPassword || undefined,
		database: redisDBIndex,
	});

	client.on('error', err => {
		logger.error('Redis Client Error:', err);
	});

	await client.connect();
	return client;
}

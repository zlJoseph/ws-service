import type { createClient } from 'redis';
import type { Cache } from 'src/application/ports';

export class CacheRepositoryRedis implements Cache {
	constructor(private readonly client: ReturnType<typeof createClient>) {}

	async get<T>(key: string): Promise<T | null> {
		const value = await this.client.get(key);
		if (!value) return null;
		return JSON.parse(value) as T;
	}

	async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
		const json = JSON.stringify(value);
		if (ttlSeconds) {
			await this.client.set(key, json, { EX: ttlSeconds });
		} else {
			await this.client.set(key, json);
		}
	}

	async del(key: string): Promise<void> {
		await this.client.del(key);
	}
}

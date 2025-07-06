import type { WorkSessionAuth } from 'src/domain/entities';
import type { Cache } from '../ports';

export class WorkSessionAuthUseCase {
	constructor(private cacheRepo: Cache) {}

	async getWorSessionAuth(token: string): Promise<[WorkSessionAuth | null, string | null]> {
		const uuid = await this.cacheRepo.get<string>(`ws-token-lookup:${token}`);
		const wsAuth = await this.cacheRepo.get<WorkSessionAuth>(`wslogin:${uuid}`);

		return [wsAuth, uuid];
	}
}

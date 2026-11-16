import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** External TVs have no bridged cache entry. Store only their validated settings. */
export class ExternalStateStore {
  private readonly directory: string;
  constructor(storage: string, scope: string) {
    this.directory = join(storage, 'broadlink-rm-state', this.hash(scope));
  }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  private file(uuid: string): string { return join(this.directory, `${this.hash(uuid)}.json`); }
  public read(uuid: string): unknown {
    let contents: string;
    try { contents = readFileSync(this.file(uuid), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const record = JSON.parse(contents);
    if (record.version !== 1 || record.uuid !== uuid) throw new Error('Invalid external accessory state record');
    return record.state;
  }
  public write(uuid: string, state: unknown): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(uuid);
    const temporary = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, uuid, state }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } finally { rmSync(temporary, { force: true }); }
  }
}

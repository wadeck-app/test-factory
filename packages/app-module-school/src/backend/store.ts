import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const COLLECTIONS = ['classrooms', 'classes', 'teachers', 'courses', 'slots'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export type StoredRecord = { id: string } & Record<string, unknown>;

export interface CollectionStore<T extends StoredRecord = StoredRecord> {
  list(): T[];
  get(id: string): T | undefined;
  create(data: Omit<T, 'id'>): T;
  insert(record: T): T;
  update(id: string, patch: Partial<Omit<T, 'id'>>): T | undefined;
  remove(id: string): boolean;
}

export interface Store {
  collection(name: CollectionName): CollectionStore;
  // Marker telling the sample data was already written, so it is never written again.
  isSeeded(): boolean;
  markSeeded(): void;
}

function createCollectionStore(dataDir: string, name: CollectionName): CollectionStore {
  const file = join(dataDir, `${name}.json`);

  const read = (): StoredRecord[] => {
    mkdirSync(dataDir, { recursive: true });
    if (!existsSync(file)) {
      writeFileSync(file, '[]', 'utf8');
    }
    return JSON.parse(readFileSync(file, 'utf8')) as StoredRecord[];
  };
  const write = (records: StoredRecord[]): void => {
    writeFileSync(file, JSON.stringify(records, null, 2), 'utf8');
  };

  return {
    list: () => read(),
    get: (id) => read().find((r) => r.id === id),
    create(data) {
      const records = read();
      const record = { ...data, id: randomUUID() } as StoredRecord;
      records.push(record);
      write(records);
      return record;
    },
    insert(record) {
      const records = read();
      records.push(record);
      write(records);
      return record;
    },
    update(id, patch) {
      const records = read();
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) {
        return undefined;
      }
      const updated = { ...records[index], ...patch, id } as StoredRecord;
      records[index] = updated;
      write(records);
      return updated;
    },
    remove(id) {
      const records = read();
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) {
        return false;
      }
      records.splice(index, 1);
      write(records);
      return true;
    },
  };
}

export const SEEDED_MARKER = 'seeded.flag';

export function createStore(dataDir: string): Store {
  return {
    isSeeded: () => existsSync(join(dataDir, SEEDED_MARKER)),
    markSeeded() {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, SEEDED_MARKER), '', 'utf8');
    },
    collection(name) {
      if (!(COLLECTIONS as readonly string[]).includes(name)) {
        throw new Error(`Unknown collection: ${name}`);
      }
      return createCollectionStore(dataDir, name);
    },
  };
}

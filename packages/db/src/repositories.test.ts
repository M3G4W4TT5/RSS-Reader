import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CollectionsRepository,
  createDatabase,
  migrateToLatest,
  normalizeFeedUrl,
  SourcesRepository,
} from './index';

describe('normalizeFeedUrl', () => {
  it('normalizes the host, default port, and fragment', () => {
    expect(normalizeFeedUrl(' HTTPS://EXAMPLE.COM:443/feed.xml#latest ')).toBe(
      'https://example.com/feed.xml',
    );
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeFeedUrl('https://user:secret@example.com/feed')).toThrow(
      /credentials/,
    );
  });
});

describe('source and collection repositories', () => {
  it('persists CRUD, enable state, and many-to-many membership', async () => {
    const database = createDatabase();
    const sources = new SourcesRepository(database);
    const collections = new CollectionsRepository(database);
    const suffix = randomUUID();
    let sourceId: string | undefined;
    const collectionIds: string[] = [];

    try {
      await migrateToLatest(database);
      const first = await collections.create({ name: `First ${suffix}`, icon: 'technology' });
      const second = await collections.create({ name: `Second ${suffix}`, icon: 'nature' });
      collectionIds.push(first.id, second.id);

      const source = await sources.create({
        feedUrl: `https://example.com/${suffix}/feed.xml`,
        collectionIds: [first.id, second.id],
      });
      sourceId = source.id;

      expect(source.name).toBe('example.com');
      expect(source.enabled).toBe(true);
      expect(source.collectionIds).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );

      const updated = await sources.update({
        id: source.id,
        input: {
          name: 'Example feed',
          feedUrl: source.feedUrl,
          enabled: false,
          collectionIds: [first.id, second.id],
        },
      });
      expect(updated.enabled).toBe(false);

      const restartedDatabase = createDatabase();
      try {
        const persisted = await new SourcesRepository(restartedDatabase).get(
          source.id,
        );
        expect(persisted).toMatchObject({
          name: 'Example feed',
          enabled: false,
        });
        expect(persisted.collectionIds).toEqual(
          expect.arrayContaining([first.id, second.id]),
        );
      } finally {
        await restartedDatabase.destroy();
      }

      await collections.removeSource(second.id, source.id);
      expect((await sources.get(source.id)).collectionIds).toEqual([first.id]);
      await collections.addSource(second.id, source.id);

      const renamed = await collections.update({
        id: first.id,
        input: { name: `Renamed ${suffix}`, icon: 'science', sourceIds: [source.id] },
      });
      expect(renamed.name).toBe(`Renamed ${suffix}`);
      expect(renamed.icon).toBe('science');
      expect(renamed.sourceCount).toBe(1);

      await collections.delete(first.id);
      collectionIds.splice(collectionIds.indexOf(first.id), 1);
      expect((await sources.get(source.id)).collectionIds).toEqual([second.id]);

      await sources.delete(source.id);
      sourceId = undefined;
      expect((await collections.list()).find(({ id }) => id === second.id)).toMatchObject(
        { sourceCount: 0 },
      );
    } finally {
      if (sourceId) {
        await database
          .deleteFrom('sources')
          .where('id', '=', sourceId)
          .execute();
      }
      if (collectionIds.length > 0) {
        await database
          .deleteFrom('collections')
          .where('id', 'in', collectionIds)
          .execute();
      }
      await database.destroy();
    }
  });

  it('atomically renames a collection and replaces its source membership', async () => {
    const database = createDatabase();
    const sources = new SourcesRepository(database);
    const collections = new CollectionsRepository(database);
    const suffix = randomUUID();
    const sourceIds: string[] = [];
    let collectionId: string | undefined;

    try {
      await migrateToLatest(database);
      const collection = await collections.create({name: `Atomic ${suffix}`, icon: 'folder'});
      collectionId = collection.id;
      const first = await sources.create({
        feedUrl: `https://example.com/${suffix}/first.xml`,
        collectionIds: [collection.id],
      });
      const second = await sources.create({
        feedUrl: `https://example.com/${suffix}/second.xml`,
        collectionIds: [],
      });
      sourceIds.push(first.id, second.id);

      const updated = await collections.update({
        id: collection.id,
        input: {name: `Updated ${suffix}`, icon: 'business', sourceIds: [second.id, second.id]},
      });
      expect(updated).toMatchObject({name: `Updated ${suffix}`, sourceCount: 1});
      expect((await sources.get(first.id)).collectionIds).not.toContain(collection.id);
      expect((await sources.get(second.id)).collectionIds).toContain(collection.id);

      await expect(collections.update({
        id: collection.id,
        input: {
          name: `Should roll back ${suffix}`, icon: 'news',
          sourceIds: [randomUUID()],
        },
      })).rejects.toThrow(/no longer exists/);

      expect((await collections.list()).find(({id}) => id === collection.id)).toMatchObject({
        name: `Updated ${suffix}`,
        sourceCount: 1,
      });
      expect((await sources.get(second.id)).collectionIds).toContain(collection.id);
    } finally {
      if (sourceIds.length > 0) {
        await database.deleteFrom('sources').where('id', 'in', sourceIds).execute();
      }
      if (collectionId) {
        await database.deleteFrom('collections').where('id', '=', collectionId).execute();
      }
      await database.destroy();
    }
  });

  it('deletes multiple selected sources atomically', async () => {
    const database = createDatabase();
    const sources = new SourcesRepository(database);
    const suffix = randomUUID();
    const sourceIds: string[] = [];
    try {
      await migrateToLatest(database);
      for (const name of ['first', 'second']) {
        sourceIds.push((await sources.create({
          feedUrl: `https://example.com/${suffix}/${name}.xml`,
          collectionIds: [],
        })).id);
      }
      await expect(sources.deleteMany([...sourceIds, randomUUID()])).rejects.toThrow(/no longer exist/);
      await expect(sources.get(sourceIds[0]!)).resolves.toBeDefined();
      await sources.deleteMany(sourceIds);
      await expect(sources.get(sourceIds[0]!)).rejects.toThrow(/not found/);
      sourceIds.length = 0;
    } finally {
      if (sourceIds.length > 0) await database.deleteFrom('sources').where('id', 'in', sourceIds).execute();
      await database.destroy();
    }
  });
});

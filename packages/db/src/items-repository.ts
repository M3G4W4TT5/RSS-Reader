import type {
    ItemDetail,
    ItemQuery,
    ItemSummary,
} from '@rss-reader/contracts';
import {sql} from 'kysely';
import type {Database} from './database';
import { ArticleContentRepository } from './article-content-repository';
import {SavedArticlesRepository} from './saved-articles-repository';

function iso(value: Date | string): string {
    return new Date(value).toISOString();
}

interface ItemRow {
    id: string;
    source_id: string;
    source_name: string;
    title: string;
    author: string | null;
    canonical_url: string | null;
    published_at: Date | string | null;
    first_seen_at: Date | string;
    read_at: Date | string | null;
}

function summary(row: ItemRow, saved: Awaited<ReturnType<SavedArticlesRepository['getForItem']>> = {
    savedArticleId: null, starredAt: null, readLaterAt: null, tags: [],
}): ItemSummary {
    return {
        id: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        title: row.title,
        author: row.author,
        canonicalUrl: row.canonical_url,
        publishedAt: row.published_at ? iso(row.published_at) : null,
        firstSeenAt: iso(row.first_seen_at),
        readAt: row.read_at ? iso(row.read_at) : null,
        ...saved,
    };
}

export class ItemsRepository {
    constructor(private readonly database: Database) {
    }

    async list(query: ItemQuery): Promise<ItemSummary[]> {
        let builder = this.database
            .selectFrom('items')
            .innerJoin('sources', 'sources.id', 'items.source_id')
            .leftJoin('saved_articles', 'saved_articles.item_id', 'items.id')
            .select([
                'items.id',
                'items.source_id',
                'sources.name as source_name',
                'items.title',
                'items.author',
                'items.canonical_url',
                'items.published_at',
                'items.first_seen_at',
                'items.read_at',
            ]);
        if (query.collectionId) {
            builder = builder
                .innerJoin(
                    'collection_sources',
                    'collection_sources.source_id',
                    'items.source_id',
                )
                .where('collection_sources.collection_id', '=', query.collectionId);
        }
        if (query.sourceId) {
            builder = builder.where('items.source_id', '=', query.sourceId);
        }
        if (query.unreadOnly) {
            builder = builder.where('items.read_at', 'is', null);
        }
        if (query.starredOnly) builder = builder.where('saved_articles.starred_at', 'is not', null);
        if (query.readLaterOnly) builder = builder.where('saved_articles.read_later_at', 'is not', null);
        if (query.tagId) {
            builder = builder.where('saved_articles.id', 'in', this.database.selectFrom('saved_article_tags')
                .select('saved_article_id').where('tag_id', '=', query.tagId));
        }
        const rows = await builder
            .orderBy(query.readLaterOnly ? sql`saved_articles.read_later_at` : sql`coalesce(items.published_at, items.first_seen_at)`, 'desc')
            .orderBy('items.id', 'desc')
            .execute();
        const states = await new SavedArticlesRepository(this.database).getForItems(rows.map((row) => row.id));
        return rows.map((row) => summary(row, states.get(row.id)));
    }

    async get(id: string): Promise<ItemDetail> {
        const row = await this.database
            .selectFrom('items')
            .innerJoin('sources', 'sources.id', 'items.source_id')
            .select([
                'items.id',
                'items.source_id',
                'sources.name as source_name',
                'items.title',
                'items.author',
                'items.canonical_url',
                'items.published_at',
                'items.first_seen_at',
                'items.read_at',
                'items.summary',
                'items.feed_content_html',
            ])
            .where('items.id', '=', id)
            .executeTakeFirst();
        if (!row) throw new Error('Item not found.');
        return {
            ...summary(row, await new SavedArticlesRepository(this.database).getForItem(id)),
            summary: row.summary,
            feedContentHtml: row.feed_content_html,
            articleContent: await new ArticleContentRepository(this.database).get(id),
        };
    }

    async setRead(id: string, read: boolean): Promise<ItemDetail> {
        const updated = await this.database
            .updateTable('items')
            .set({
                read_at: read ? new Date() : null,
                updated_at: new Date(),
            })
            .where('id', '=', id)
            .returning('id')
            .executeTakeFirst();
        if (!updated) throw new Error('Item not found.');
        return this.get(id);
    }
}

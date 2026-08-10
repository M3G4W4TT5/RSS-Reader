import type {ArticleContent} from '@rss-reader/contracts';
import type {Selectable} from 'kysely';
import type {
    Database,
    ExtractionStatus,
    ItemContentTable,
} from './database';

function iso(value: Date | string): string {
    return new Date(value).toISOString();
}

function emptyContent(): ArticleContent {
    return {
        status: 'not_requested',
        retrievedUrl: null,
        readerHtml: null,
        readerText: null,
        extractionError: null,
        fetchedAt: null,
        updatedAt: null,
    };
}

function toDto(row: Selectable<ItemContentTable>): ArticleContent {
    return {
        status: row.extraction_status,
        retrievedUrl: row.retrieved_url,
        readerHtml: row.reader_html,
        readerText: row.reader_text,
        extractionError: row.extraction_error,
        fetchedAt: row.fetched_at ? iso(row.fetched_at) : null,
        updatedAt: iso(row.updated_at),
    };
}

export interface PersistArticleContent {
    status: Extract<ExtractionStatus, 'complete' | 'partial'>;
    retrievedUrl: string;
    rawHtml: string;
    readerHtml: string | null;
    readerText: string | null;
    error: string | null;
    images: PersistArticleImage[];
}

export interface PersistArticleImage {
    id: string;
    originalUrl: string;
    mimeType: string;
    width: number;
    height: number;
    data: Buffer;
}

export interface ArticleTarget {
    canonicalUrl: string | null;
    feedContentHtml: string | null;
    summary: string | null;
    feedUrl: string;
}

export interface CachedArticleImage {
    mimeType: string;
    data: Buffer;
}

export class ArticleContentRepository {
    constructor(private readonly database: Database) {
    }

    async get(itemId: string): Promise<ArticleContent> {
        const row = await this.database
            .selectFrom('item_content')
            .selectAll()
            .where('item_id', '=', itemId)
            .executeTakeFirst();
        return row ? toDto(row) : emptyContent();
    }

    async getTarget(itemId: string): Promise<ArticleTarget> {
        const item = await this.database
            .selectFrom('items')
            .innerJoin('sources', 'sources.id', 'items.source_id')
            .select([
                'items.canonical_url',
                'items.feed_content_html',
                'items.summary',
                'sources.feed_url',
            ])
            .where('items.id', '=', itemId)
            .executeTakeFirst();
        if (!item) throw new Error('Item not found.');
        return {
            canonicalUrl: item.canonical_url,
            feedContentHtml: item.feed_content_html,
            summary: item.summary,
            feedUrl: item.feed_url,
        };
    }

    async getImage(itemId: string, imageId: string): Promise<CachedArticleImage | undefined> {
        const image = await this.database
            .selectFrom('article_images')
            .select(['mime_type', 'data'])
            .where('item_id', '=', itemId)
            .where('id', '=', imageId)
            .executeTakeFirst();
        return image ? {mimeType: image.mime_type, data: image.data} : undefined;
    }

    async markFetching(itemId: string, url: string | null): Promise<ArticleContent> {
        const now = new Date();
        const row = await this.database
            .insertInto('item_content')
            .values({
                item_id: itemId,
                retrieved_url: url,
                raw_html: null,
                reader_html: null,
                reader_text: null,
                extraction_status: 'fetching',
                extraction_error: null,
                fetched_at: null,
                updated_at: now,
            })
            .onConflict((conflict) =>
                conflict.column('item_id').doUpdateSet({
                    retrieved_url: url,
                    extraction_status: 'fetching',
                    extraction_error: null,
                    updated_at: now,
                }),
            )
            .returningAll()
            .executeTakeFirstOrThrow();
        return toDto(row);
    }

    async persist(
        itemId: string,
        content: PersistArticleContent,
    ): Promise<ArticleContent> {
        return this.database.transaction().execute(async (transaction) => {
            const now = new Date();
            const row = await transaction
                .updateTable('item_content')
                .set({
                    retrieved_url: content.retrievedUrl,
                    raw_html: content.rawHtml,
                    reader_html: content.readerHtml,
                    reader_text: content.readerText,
                    extraction_status: content.status,
                    extraction_error: content.error,
                    fetched_at: now,
                    updated_at: now,
                })
                .where('item_id', '=', itemId)
                .returningAll()
                .executeTakeFirstOrThrow();
            await transaction
                .deleteFrom('article_images')
                .where('item_id', '=', itemId)
                .execute();
            if (content.images.length > 0) {
                await transaction
                    .insertInto('article_images')
                    .values(content.images.map((image) => ({
                        id: image.id,
                        item_id: itemId,
                        original_url: image.originalUrl,
                        mime_type: image.mimeType,
                        width: image.width,
                        height: image.height,
                        byte_length: image.data.byteLength,
                        data: image.data,
                        created_at: now,
                    })))
                    .execute();
            }
            return toDto(row);
        });
    }

    async fail(
        itemId: string,
        retrievedUrl: string | null,
        error: string,
    ): Promise<ArticleContent> {
        return this.database.transaction().execute(async (transaction) => {
        const now = new Date();
        const row = await transaction
            .insertInto('item_content')
            .values({
                item_id: itemId,
                retrieved_url: retrievedUrl,
                raw_html: null,
                reader_html: null,
                reader_text: null,
                extraction_status: 'failed',
                extraction_error: error,
                fetched_at: null,
                updated_at: now,
            })
            .onConflict((conflict) =>
                conflict.column('item_id').doUpdateSet({
                    retrieved_url: retrievedUrl,
                    raw_html: null,
                    reader_html: null,
                    reader_text: null,
                    extraction_status: 'failed',
                    extraction_error: error,
                    fetched_at: null,
                    updated_at: now,
                }),
            )
            .returningAll()
            .executeTakeFirstOrThrow();
        await transaction
            .deleteFrom('article_images')
            .where('item_id', '=', itemId)
            .execute();
        return toDto(row);
        });
    }
}

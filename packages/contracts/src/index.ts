import {z} from 'zod';

export const ipcChannels = {
    healthCheck: 'health:check',
    sourcesList: 'sources:list',
    sourcesGet: 'sources:get',
    sourcesCreate: 'sources:create',
    sourcesUpdate: 'sources:update',
    sourcesDelete: 'sources:delete',
    sourcesDeleteMany: 'sources:delete-many',
    sourcesFetch: 'sources:fetch',
    sourcesImportFile: 'sources:import-file',
    sourcesImportGetStatus: 'sources:import-get-status',
    collectionsList: 'collections:list',
    collectionsCreate: 'collections:create',
    collectionsUpdate: 'collections:update',
    collectionsDelete: 'collections:delete',
    collectionsAddSource: 'collections:add-source',
    collectionsRemoveSource: 'collections:remove-source',
    fetchAll: 'fetch:all',
    fetchGetStatus: 'fetch:get-status',
    itemsList: 'items:list',
    itemsGet: 'items:get',
    itemsSetRead: 'items:set-read',
    itemsOpenOriginal: 'items:open-original',
    itemsExtractArticle: 'items:extract-article',
    itemsOpenExternalLink: 'items:open-external-link',
    notesList: 'notes:list',
    notesListForItem: 'notes:list-for-item',
    notesCreate: 'notes:create',
    notesUpdate: 'notes:update',
    notesDelete: 'notes:delete',
    notesOpenOriginal: 'notes:open-original',
    savedSetStarred: 'saved:set-starred',
    savedSetReadLater: 'saved:set-read-later',
    savedSetTags: 'saved:set-tags',
    savedListArchived: 'saved:list-archived',
    savedOpenOriginal: 'saved:open-original',
    tagsList: 'tags:list',
    tagsCreate: 'tags:create',
    tagsUpdate: 'tags:update',
    tagsDelete: 'tags:delete',
    appCommand: 'app:command',
    settingsGet: 'settings:get',
    settingsUpdate: 'settings:update',
} as const;

export const healthCheckResponseSchema = z.object({
    status: z.literal('ok'),
    database: z.object({
        name: z.string().min(1),
        time: z.iso.datetime(),
        migration: z.string().regex(/^stage-\d+$/),
    }),
});

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;

const idSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();
const requiredNameSchema = z.string().trim().min(1).max(200);
const feedUrlSchema = z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'Feed URL must use HTTP or HTTPS.',
    });

export const sourceSchema = z.object({
    id: idSchema,
    name: requiredNameSchema,
    feedUrl: feedUrlSchema,
    siteUrl: z.url().nullable(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    lastFetchedAt: dateTimeSchema.nullable(),
    collectionIds: z.array(idSchema),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
});

export type Source = z.infer<typeof sourceSchema>;

export const sourceListSchema = z.array(sourceSchema);
export const sourceIdSchema = idSchema;
export const createSourceInputSchema = z.object({
    feedUrl: feedUrlSchema,
    name: requiredNameSchema.optional(),
    collectionIds: z.array(idSchema).default([]),
});
export type CreateSourceInput = z.infer<typeof createSourceInputSchema>;

export const updateSourceRequestSchema = z.object({
    id: idSchema,
    input: z.object({
        name: requiredNameSchema,
        feedUrl: feedUrlSchema,
        enabled: z.boolean(),
        collectionIds: z.array(idSchema),
    }),
});
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;

export const collectionIconSchema = z.enum([
    'folder', 'business', 'technology', 'science', 'nature', 'design', 'news', 'world', 'learning',
]);
export type CollectionIcon = z.infer<typeof collectionIconSchema>;

export const collectionSchema = z.object({
    id: idSchema,
    name: requiredNameSchema,
    icon: collectionIconSchema,
    sourceCount: z.number().int().nonnegative(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
});
export type Collection = z.infer<typeof collectionSchema>;

export const collectionListSchema = z.array(collectionSchema);
export const createCollectionInputSchema = z.object({
    name: requiredNameSchema,
    icon: collectionIconSchema,
});
export type CreateCollectionInput = z.infer<
    typeof createCollectionInputSchema
>;

export const updateCollectionRequestSchema = z.object({
    id: idSchema,
    input: createCollectionInputSchema.extend({
        sourceIds: z.array(idSchema),
    }),
});
export type UpdateCollectionRequest = z.infer<
    typeof updateCollectionRequestSchema
>;

export const deleteRequestSchema = z.object({id: idSchema});
export const deleteSourcesRequestSchema = z.object({
    ids: z.array(idSchema).min(1).max(10_000).transform((ids) => [...new Set(ids)]),
});
export type DeleteSourcesRequest = z.infer<typeof deleteSourcesRequestSchema>;
export const membershipRequestSchema = z.object({
    collectionId: idSchema,
    sourceId: idSchema,
});
export const mutationResultSchema = z.object({success: z.literal(true)});
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const applicationSettingsSchema = z.object({
    initialArticleLimit: z.number().int().min(1).max(500),
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;
export const updateApplicationSettingsSchema = applicationSettingsSchema;
export type UpdateApplicationSettings = z.infer<typeof updateApplicationSettingsSchema>;

export const fetchErrorCategorySchema = z.enum([
    'network',
    'timeout',
    'http',
    'invalid_feed',
    'unsupported_response',
    'database',
    'unknown',
]);
export type FetchErrorCategory = z.infer<typeof fetchErrorCategorySchema>;

export const fetchSourceResultSchema = z.object({
    sourceId: idSchema,
    sourceName: requiredNameSchema,
    status: z.enum(['success', 'unchanged', 'failed']),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    itemsReceived: z.number().int().nonnegative(),
    itemsInserted: z.number().int().nonnegative(),
    itemsUpdated: z.number().int().nonnegative(),
    itemsSkipped: z.number().int().nonnegative(),
    errorCategory: fetchErrorCategorySchema.nullable(),
    errorMessage: z.string().nullable(),
    startedAt: dateTimeSchema,
    completedAt: dateTimeSchema,
});
export type FetchSourceResult = z.infer<typeof fetchSourceResultSchema>;

export const createSourceResultSchema = z.object({
    source: sourceSchema,
    fetchResult: fetchSourceResultSchema,
});
export type CreateSourceResult = z.infer<typeof createSourceResultSchema>;

export const sourceImportRowSchema = z.object({
    url: feedUrlSchema,
    name: requiredNameSchema.optional(),
    collection: z.string().trim().max(2_000).optional(),
});
export type SourceImportRow = z.infer<typeof sourceImportRowSchema>;

export const sourceImportRowResultSchema = z.object({
    row: z.number().int().positive(),
    url: feedUrlSchema,
    name: z.string().nullable(),
    status: z.enum(['imported', 'updated', 'failed']),
    sourceId: idSchema.nullable(),
    errorMessage: z.string().nullable(),
});
export type SourceImportRowResult = z.infer<typeof sourceImportRowResultSchema>;

export const sourceImportResultSchema = z.object({
    canceled: z.boolean(),
    fileName: z.string().nullable(),
    totalRows: z.number().int().nonnegative(),
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    collectionsCreated: z.number().int().nonnegative(),
    results: z.array(sourceImportRowResultSchema),
});
export type SourceImportResult = z.infer<typeof sourceImportResultSchema>;

export const sourceImportStatusSchema = z.object({
    running: z.boolean(),
    fileName: z.string().nullable(),
    totalRows: z.number().int().nonnegative(),
    completedRows: z.number().int().nonnegative(),
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    collectionsCreated: z.number().int().nonnegative(),
    startedAt: dateTimeSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
});
export type SourceImportStatus = z.infer<typeof sourceImportStatusSchema>;

export const fetchAllResultSchema = z.object({
    totalSources: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    itemsInserted: z.number().int().nonnegative(),
    itemsUpdated: z.number().int().nonnegative(),
    itemsSkipped: z.number().int().nonnegative(),
    results: z.array(fetchSourceResultSchema),
});
export type FetchAllResult = z.infer<typeof fetchAllResultSchema>;

export const fetchOperationStatusSchema = z.object({
    running: z.boolean(),
    mode: z.enum(['single', 'all']).nullable(),
    startedAt: dateTimeSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
    totalSources: z.number().int().nonnegative(),
    completedSources: z.number().int().nonnegative(),
    sources: z.array(
        z.object({
            sourceId: idSchema,
            sourceName: requiredNameSchema,
            status: z.enum([
                'pending',
                'fetching',
                'success',
                'unchanged',
                'failed',
            ]),
            itemsInserted: z.number().int().nonnegative(),
            itemsUpdated: z.number().int().nonnegative(),
            itemsSkipped: z.number().int().nonnegative(),
            errorMessage: z.string().nullable(),
        }),
    ),
});
export type FetchOperationStatus = z.infer<typeof fetchOperationStatusSchema>;

export const itemQuerySchema = z.object({
    unreadOnly: z.boolean().default(false),
    sourceId: idSchema.optional(),
    collectionId: idSchema.optional(),
    starredOnly: z.boolean().optional(),
    readLaterOnly: z.boolean().optional(),
    tagId: idSchema.optional(),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

export const articleTagSchema = z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(50),
    articleCount: z.number().int().nonnegative(),
});
export type ArticleTag = z.infer<typeof articleTagSchema>;
export const articleTagListSchema = z.array(articleTagSchema);

export const savedArticleStateSchema = z.object({
    savedArticleId: idSchema.nullable(),
    starredAt: dateTimeSchema.nullable(),
    readLaterAt: dateTimeSchema.nullable(),
    tags: articleTagListSchema,
});
export type SavedArticleState = z.infer<typeof savedArticleStateSchema>;

export const itemSummarySchema = z.object({
    id: idSchema,
    sourceId: idSchema,
    sourceName: requiredNameSchema,
    title: z.string().min(1),
    author: z.string().nullable(),
    canonicalUrl: z.url().nullable(),
    publishedAt: dateTimeSchema.nullable(),
    firstSeenAt: dateTimeSchema,
    readAt: dateTimeSchema.nullable(),
    savedArticleId: idSchema.nullable(),
    starredAt: dateTimeSchema.nullable(),
    readLaterAt: dateTimeSchema.nullable(),
    tags: articleTagListSchema,
});
export type ItemSummary = z.infer<typeof itemSummarySchema>;
export const itemListSchema = z.array(itemSummarySchema);

export const itemDetailSchema = itemSummarySchema.extend({
    summary: z.string().nullable(),
    feedContentHtml: z.string().nullable(),
    articleContent: z.object({
        status: z.enum([
            'not_requested',
            'fetching',
            'complete',
            'partial',
            'failed',
        ]),
        retrievedUrl: z.url().nullable(),
        readerHtml: z.string().nullable(),
        readerText: z.string().nullable(),
        extractionError: z.string().nullable(),
        fetchedAt: dateTimeSchema.nullable(),
        updatedAt: dateTimeSchema.nullable(),
    }),
});
export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const articleContentSchema = itemDetailSchema.shape.articleContent;
export type ArticleContent = z.infer<typeof articleContentSchema>;

export const extractArticleRequestSchema = z.object({
    id: idSchema,
    retry: z.boolean().default(false),
});
export const articleExtractionResultSchema = articleContentSchema.extend({
    cached: z.boolean(),
});
export type ArticleExtractionResult = z.infer<
    typeof articleExtractionResultSchema
>;

export const openExternalLinkRequestSchema = z.object({
    itemId: idSchema,
    url: feedUrlSchema,
});

export const appCommandSchema = z.enum([
    'add-source',
    'import-sources',
    'fetch-all',
    'next-item',
    'previous-item',
    'mark-unread',
    'open-original',
    'toggle-starred',
    'toggle-read-later',
    'edit-tags',
]);
export type AppCommand = z.infer<typeof appCommandSchema>;

export const setItemReadRequestSchema = z.object({
    id: idSchema,
    read: z.boolean(),
});
export type SetItemReadRequest = z.infer<typeof setItemReadRequestSchema>;

export const setSavedFlagRequestSchema = z.object({id: idSchema, enabled: z.boolean()});
export const setArticleTagsRequestSchema = z.object({itemId: idSchema, tagIds: z.array(idSchema).max(100).transform((ids) => [...new Set(ids)])});
export const tagNameSchema = z.string().normalize('NFKC').trim().min(1).max(50);
export const createTagRequestSchema = z.object({name: tagNameSchema});
export const updateTagRequestSchema = z.object({id: idSchema, name: tagNameSchema});
export const archivedSavedArticleQuerySchema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('starred')}),
    z.object({kind: z.literal('readLater')}),
    z.object({kind: z.literal('tag'), tagId: idSchema}),
]);
export type ArchivedSavedArticleQuery = z.infer<typeof archivedSavedArticleQuerySchema>;
export const savedArticleSchema = z.object({
    id: idSchema,
    itemId: idSchema.nullable(),
    articleTitle: z.string().min(1),
    sourceName: z.string().min(1),
    canonicalUrl: z.url().nullable(),
    collectionNames: z.array(z.string().min(1)),
    starredAt: dateTimeSchema.nullable(),
    readLaterAt: dateTimeSchema.nullable(),
    tags: articleTagListSchema,
});
export type SavedArticle = z.infer<typeof savedArticleSchema>;
export const savedArticleListSchema = z.array(savedArticleSchema);

export const openOriginalResultSchema = z.object({opened: z.literal(true)});
export type OpenOriginalResult = z.infer<typeof openOriginalResultSchema>;

export const textAnchorSchema = z.object({
    exact: z.string().min(1).max(20_000),
    prefix: z.string().max(500),
    suffix: z.string().max(500),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    contentHash: z.string().min(1).max(100),
}).refine((anchor) => anchor.end > anchor.start, {
    message: 'The note selection must contain text.',
});
export type TextAnchor = z.infer<typeof textAnchorSchema>;

export const noteSchema = z.object({
    id: idSchema,
    itemId: idSchema.nullable(),
    quoteText: z.string().min(1),
    annotationText: z.string().nullable(),
    anchor: textAnchorSchema,
    articleTitle: z.string().min(1),
    sourceName: z.string().min(1),
    canonicalUrl: z.url().nullable(),
    collectionNames: z.array(z.string().min(1)),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
});
export type Note = z.infer<typeof noteSchema>;
export const noteListSchema = z.array(noteSchema);
export const createNoteRequestSchema = z.object({
    itemId: idSchema,
    quoteText: z.string().trim().min(1).max(20_000),
    annotationText: z.string().trim().max(10_000).nullable(),
    anchor: textAnchorSchema,
});
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;
export const updateNoteRequestSchema = z.object({
    id: idSchema,
    annotationText: z.string().trim().max(10_000).nullable(),
});
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;

export interface ReaderApi {
    health: {
        check(): Promise<HealthCheckResponse>;
    };
    sources: {
        list(): Promise<Source[]>;
        get(id: string): Promise<Source>;
        create(input: CreateSourceInput): Promise<CreateSourceResult>;
        update(request: UpdateSourceRequest): Promise<Source>;
        delete(id: string): Promise<MutationResult>;
        deleteMany(ids: string[]): Promise<MutationResult>;
        fetch(id: string): Promise<FetchSourceResult>;
        importFile(): Promise<SourceImportResult>;
        getImportStatus(): Promise<SourceImportStatus>;
    };
    collections: {
        list(): Promise<Collection[]>;
        create(input: CreateCollectionInput): Promise<Collection>;
        update(request: UpdateCollectionRequest): Promise<Collection>;
        delete(id: string): Promise<MutationResult>;
        addSource(collectionId: string, sourceId: string): Promise<MutationResult>;
        removeSource(
            collectionId: string,
            sourceId: string,
        ): Promise<MutationResult>;
    };
    fetch: {
        all(): Promise<FetchAllResult>;
        getStatus(): Promise<FetchOperationStatus>;
    };
    items: {
        list(query: ItemQuery): Promise<ItemSummary[]>;
        get(id: string): Promise<ItemDetail>;
        setRead(id: string, read: boolean): Promise<ItemDetail>;
        openOriginal(id: string): Promise<OpenOriginalResult>;
        extractArticle(id: string, retry?: boolean): Promise<ArticleExtractionResult>;
        openExternalLink(itemId: string, url: string): Promise<OpenOriginalResult>;
    };
    saved: {
        setStarred(id: string, enabled: boolean): Promise<SavedArticleState>;
        setReadLater(id: string, enabled: boolean): Promise<SavedArticleState>;
        setTags(itemId: string, tagIds: string[]): Promise<SavedArticleState>;
        listArchived(query: ArchivedSavedArticleQuery): Promise<SavedArticle[]>;
        openOriginal(id: string): Promise<OpenOriginalResult>;
    };
    tags: {
        list(): Promise<ArticleTag[]>;
        create(name: string): Promise<ArticleTag>;
        update(id: string, name: string): Promise<ArticleTag>;
        delete(id: string): Promise<MutationResult>;
    };
    notes: {
        list(): Promise<Note[]>;
        listForItem(itemId: string): Promise<Note[]>;
        create(request: CreateNoteRequest): Promise<Note>;
        update(request: UpdateNoteRequest): Promise<Note>;
        delete(id: string): Promise<MutationResult>;
        openOriginal(id: string): Promise<OpenOriginalResult>;
    };
    app: {
        onCommand(listener: (command: AppCommand) => void): () => void;
    };
    settings: {
        get(): Promise<ApplicationSettings>;
        update(input: UpdateApplicationSettings): Promise<ApplicationSettings>;
    };
}

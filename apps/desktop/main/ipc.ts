import {BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions} from 'electron';
import {
    articleExtractionResultSchema,
    collectionListSchema,
    collectionSchema,
    createCollectionInputSchema,
    createSourceResultSchema,
    createSourceInputSchema,
    deleteRequestSchema,
    deleteSourcesRequestSchema,
    fetchAllResultSchema,
    fetchOperationStatusSchema,
    fetchSourceResultSchema,
    healthCheckResponseSchema,
    ipcChannels,
    itemDetailSchema,
    itemListSchema,
    itemQuerySchema,
    membershipRequestSchema,
    mutationResultSchema,
    openExternalLinkRequestSchema,
    sourceIdSchema,
    sourceImportResultSchema,
    sourceImportStatusSchema,
    sourceListSchema,
    sourceSchema,
    openOriginalResultSchema,
    setItemReadRequestSchema,
    extractArticleRequestSchema,
    updateCollectionRequestSchema,
    updateSourceRequestSchema,
    applicationSettingsSchema,
    updateApplicationSettingsSchema,
} from '@rss-reader/contracts';
import {
    ArticleContentRepository,
    checkDatabase,
    CollectionsRepository,
    IngestionRepository,
    ItemsRepository,
    SourcesRepository,
    SettingsRepository,
    type Database,
} from '@rss-reader/db';
import {assertPublicHttpUrl} from '@rss-reader/feeds';
import {FeedService} from './feed-service';
import {ArticleService} from './article-service';
import {SourceService} from './source-service';
import {SourceImportService} from './source-import';

export function registerIpcHandlers(database: Database): void {
    const sources = new SourcesRepository(database);
    const collections = new CollectionsRepository(database);
    const ingestion = new IngestionRepository(database);
    const feedService = new FeedService(ingestion);
    const sourceService = new SourceService(sources, ingestion);
    const sourceImportService = new SourceImportService(collections, sourceService);
    const items = new ItemsRepository(database);
    const articleService = new ArticleService(new ArticleContentRepository(database));
    const settings = new SettingsRepository(database);

    ipcMain.handle(ipcChannels.healthCheck, async () => {
        const databaseHealth = await checkDatabase(database);
        console.info(
            `[ipc] Typed preload health check succeeded for database ${databaseHealth.name}.`,
        );
        return healthCheckResponseSchema.parse({
            status: 'ok',
            database: databaseHealth,
        });
    });

    ipcMain.handle(ipcChannels.settingsGet, async () =>
        applicationSettingsSchema.parse(await settings.get()),
    );
    ipcMain.handle(ipcChannels.settingsUpdate, async (_event, raw: unknown) =>
        applicationSettingsSchema.parse(
            await settings.update(updateApplicationSettingsSchema.parse(raw)),
        ),
    );

    ipcMain.handle(ipcChannels.sourcesList, async () =>
        sourceListSchema.parse(await sources.list()),
    );
    ipcMain.handle(ipcChannels.sourcesGet, async (_event, rawId: unknown) =>
        sourceSchema.parse(await sources.get(sourceIdSchema.parse(rawId))),
    );
    ipcMain.handle(ipcChannels.sourcesCreate, async (_event, raw: unknown) =>
        createSourceResultSchema.parse(
            await sourceService.create(createSourceInputSchema.parse(raw)),
        ),
    );
    ipcMain.handle(ipcChannels.sourcesUpdate, async (_event, raw: unknown) =>
        sourceSchema.parse(
            await sourceService.update(updateSourceRequestSchema.parse(raw)),
        ),
    );
    ipcMain.handle(ipcChannels.sourcesDelete, async (_event, raw: unknown) => {
        const {id} = deleteRequestSchema.parse(raw);
        await sources.delete(id);
        return mutationResultSchema.parse({success: true});
    });
    ipcMain.handle(ipcChannels.sourcesDeleteMany, async (_event, raw: unknown) => {
        const {ids} = deleteSourcesRequestSchema.parse(raw);
        await sources.deleteMany(ids);
        return mutationResultSchema.parse({success: true});
    });
    ipcMain.handle(ipcChannels.sourcesFetch, async (_event, rawId: unknown) =>
        fetchSourceResultSchema.parse(
            await feedService.fetchSource(sourceIdSchema.parse(rawId)),
        ),
    );
    ipcMain.handle(ipcChannels.sourcesImportFile, async (event) => {
        sourceImportService.prepare();
        const owner = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: 'Import RSS/Atom sources',
            properties: ['openFile'],
            filters: [{name: 'Source lists', extensions: ['csv', 'json']}],
        };
        const selected = owner
            ? await dialog.showOpenDialog(owner, options)
            : await dialog.showOpenDialog(options);
        if (selected.canceled || !selected.filePaths[0]) {
            return sourceImportResultSchema.parse({
                canceled: true,
                fileName: null,
                totalRows: 0,
                imported: 0,
                updated: 0,
                failed: 0,
                collectionsCreated: 0,
                results: [],
            });
        }
        return sourceImportResultSchema.parse(
            await sourceImportService.importFile(selected.filePaths[0]),
        );
    });
    ipcMain.handle(ipcChannels.sourcesImportGetStatus, async () =>
        sourceImportStatusSchema.parse(sourceImportService.getStatus()),
    );

    ipcMain.handle(ipcChannels.collectionsList, async () =>
        collectionListSchema.parse(await collections.list()),
    );
    ipcMain.handle(ipcChannels.collectionsCreate, async (_event, raw: unknown) =>
        collectionSchema.parse(
            await collections.create(createCollectionInputSchema.parse(raw)),
        ),
    );
    ipcMain.handle(ipcChannels.collectionsUpdate, async (_event, raw: unknown) =>
        collectionSchema.parse(
            await collections.update(updateCollectionRequestSchema.parse(raw)),
        ),
    );
    ipcMain.handle(ipcChannels.collectionsDelete, async (_event, raw: unknown) => {
        const {id} = deleteRequestSchema.parse(raw);
        await collections.delete(id);
        return mutationResultSchema.parse({success: true});
    });
    ipcMain.handle(
        ipcChannels.collectionsAddSource,
        async (_event, raw: unknown) => {
            const request = membershipRequestSchema.parse(raw);
            await collections.addSource(request.collectionId, request.sourceId);
            return mutationResultSchema.parse({success: true});
        },
    );
    ipcMain.handle(
        ipcChannels.collectionsRemoveSource,
        async (_event, raw: unknown) => {
            const request = membershipRequestSchema.parse(raw);
            await collections.removeSource(request.collectionId, request.sourceId);
            return mutationResultSchema.parse({success: true});
        },
    );
    ipcMain.handle(ipcChannels.fetchAll, async () =>
        fetchAllResultSchema.parse(await feedService.fetchAll()),
    );
    ipcMain.handle(ipcChannels.fetchGetStatus, async () =>
        fetchOperationStatusSchema.parse(feedService.getStatus()),
    );
    ipcMain.handle(ipcChannels.itemsList, async (_event, raw: unknown) =>
        itemListSchema.parse(await items.list(itemQuerySchema.parse(raw))),
    );
    ipcMain.handle(ipcChannels.itemsGet, async (_event, rawId: unknown) =>
        itemDetailSchema.parse(await items.get(sourceIdSchema.parse(rawId))),
    );
    ipcMain.handle(ipcChannels.itemsSetRead, async (_event, raw: unknown) => {
        const request = setItemReadRequestSchema.parse(raw);
        return itemDetailSchema.parse(await items.setRead(request.id, request.read));
    });
    ipcMain.handle(ipcChannels.itemsOpenOriginal, async (_event, rawId: unknown) => {
        const item = await items.get(sourceIdSchema.parse(rawId));
        if (!item.canonicalUrl) throw new Error('This item does not include an original URL.');
        const url = await assertPublicHttpUrl(item.canonicalUrl);
        await shell.openExternal(url);
        return openOriginalResultSchema.parse({opened: true});
    });
    ipcMain.handle(ipcChannels.itemsExtractArticle, async (_event, raw: unknown) => {
        const request = extractArticleRequestSchema.parse(raw);
        return articleExtractionResultSchema.parse(
            await articleService.extract(request.id, request.retry),
        );
    });
    ipcMain.handle(ipcChannels.itemsOpenExternalLink, async (_event, raw: unknown) => {
        const request = openExternalLinkRequestSchema.parse(raw);
        await items.get(request.itemId);
        const url = await assertPublicHttpUrl(request.url);
        await shell.openExternal(url);
        return openOriginalResultSchema.parse({opened: true});
    });
}

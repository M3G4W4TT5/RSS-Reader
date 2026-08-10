import {contextBridge, ipcRenderer} from 'electron';
import {
    appCommandSchema,
    type AppCommand,
    articleExtractionResultSchema,
    collectionListSchema,
    collectionSchema,
    type CreateCollectionInput,
    type CreateSourceInput,
    createCollectionInputSchema,
    createSourceInputSchema,
    createSourceResultSchema,
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
    type ItemQuery,
    membershipRequestSchema,
    mutationResultSchema,
    openExternalLinkRequestSchema,
    openOriginalResultSchema,
    type ReaderApi,
    sourceIdSchema,
    sourceImportResultSchema,
    sourceImportStatusSchema,
    sourceListSchema,
    sourceSchema,
    setItemReadRequestSchema,
    extractArticleRequestSchema,
    updateCollectionRequestSchema,
    type UpdateCollectionRequest,
    updateSourceRequestSchema,
    type UpdateSourceRequest,
    applicationSettingsSchema,
    updateApplicationSettingsSchema,
    type UpdateApplicationSettings,
} from '@rss-reader/contracts';

const readerApi: ReaderApi = Object.freeze({
    health: Object.freeze({
        check: async () =>
            healthCheckResponseSchema.parse(
                await ipcRenderer.invoke(ipcChannels.healthCheck),
            ),
    }),
    sources: Object.freeze({
        list: async () =>
            sourceListSchema.parse(await ipcRenderer.invoke(ipcChannels.sourcesList)),
        get: async (id: string) =>
            sourceSchema.parse(
                await ipcRenderer.invoke(ipcChannels.sourcesGet, sourceIdSchema.parse(id)),
            ),
        create: async (input: CreateSourceInput) =>
            createSourceResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.sourcesCreate,
                    createSourceInputSchema.parse(input),
                ),
            ),
        update: async (request: UpdateSourceRequest) =>
            sourceSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.sourcesUpdate,
                    updateSourceRequestSchema.parse(request),
                ),
            ),
        delete: async (id: string) =>
            mutationResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.sourcesDelete,
                    deleteRequestSchema.parse({id}),
                ),
            ),
        deleteMany: async (ids: string[]) =>
            mutationResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.sourcesDeleteMany,
                    deleteSourcesRequestSchema.parse({ids}),
                ),
            ),
        fetch: async (id: string) =>
            fetchSourceResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.sourcesFetch,
                    sourceIdSchema.parse(id),
                ),
            ),
        importFile: async () =>
            sourceImportResultSchema.parse(
                await ipcRenderer.invoke(ipcChannels.sourcesImportFile),
            ),
        getImportStatus: async () =>
            sourceImportStatusSchema.parse(
                await ipcRenderer.invoke(ipcChannels.sourcesImportGetStatus),
            ),
    }),
    collections: Object.freeze({
        list: async () =>
            collectionListSchema.parse(
                await ipcRenderer.invoke(ipcChannels.collectionsList),
            ),
        create: async (input: CreateCollectionInput) =>
            collectionSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.collectionsCreate,
                    createCollectionInputSchema.parse(input),
                ),
            ),
        update: async (request: UpdateCollectionRequest) =>
            collectionSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.collectionsUpdate,
                    updateCollectionRequestSchema.parse(request),
                ),
            ),
        delete: async (id: string) =>
            mutationResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.collectionsDelete,
                    deleteRequestSchema.parse({id}),
                ),
            ),
        addSource: async (collectionId: string, sourceId: string) =>
            mutationResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.collectionsAddSource,
                    membershipRequestSchema.parse({collectionId, sourceId}),
                ),
            ),
        removeSource: async (collectionId: string, sourceId: string) =>
            mutationResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.collectionsRemoveSource,
                    membershipRequestSchema.parse({collectionId, sourceId}),
                ),
            ),
    }),
    fetch: Object.freeze({
        all: async () =>
            fetchAllResultSchema.parse(
                await ipcRenderer.invoke(ipcChannels.fetchAll),
            ),
        getStatus: async () =>
            fetchOperationStatusSchema.parse(
                await ipcRenderer.invoke(ipcChannels.fetchGetStatus),
            ),
    }),
    items: Object.freeze({
        list: async (query: ItemQuery) =>
            itemListSchema.parse(
                await ipcRenderer.invoke(ipcChannels.itemsList, itemQuerySchema.parse(query)),
            ),
        get: async (id: string) =>
            itemDetailSchema.parse(
                await ipcRenderer.invoke(ipcChannels.itemsGet, sourceIdSchema.parse(id)),
            ),
        setRead: async (id: string, read: boolean) =>
            itemDetailSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.itemsSetRead,
                    setItemReadRequestSchema.parse({id, read}),
                ),
            ),
        openOriginal: async (id: string) =>
            openOriginalResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.itemsOpenOriginal,
                    sourceIdSchema.parse(id),
                ),
            ),
        extractArticle: async (id: string, retry = false) =>
            articleExtractionResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.itemsExtractArticle,
                    extractArticleRequestSchema.parse({id, retry}),
                ),
            ),
        openExternalLink: async (itemId: string, url: string) =>
            openOriginalResultSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.itemsOpenExternalLink,
                    openExternalLinkRequestSchema.parse({itemId, url}),
                ),
            ),
    }),
    app: Object.freeze({
        onCommand: (listener: (command: AppCommand) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
                listener(appCommandSchema.parse(raw));
            };
            ipcRenderer.on(ipcChannels.appCommand, handler);
            return () => ipcRenderer.removeListener(ipcChannels.appCommand, handler);
        },
    }),
    settings: Object.freeze({
        get: async () =>
            applicationSettingsSchema.parse(
                await ipcRenderer.invoke(ipcChannels.settingsGet),
            ),
        update: async (input: UpdateApplicationSettings) =>
            applicationSettingsSchema.parse(
                await ipcRenderer.invoke(
                    ipcChannels.settingsUpdate,
                    updateApplicationSettingsSchema.parse(input),
                ),
            ),
    }),
});

contextBridge.exposeInMainWorld('readerApi', readerApi);

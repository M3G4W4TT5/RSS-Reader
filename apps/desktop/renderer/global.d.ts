import type { ReaderApi } from '@rss-reader/contracts';

declare global {
  interface Window {
    readerApi: ReaderApi;
  }
}

export {};


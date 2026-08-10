import {defineConfig} from 'vite';

export default defineConfig({
    build: {
        rollupOptions: {
            external: ['jsdom', 'pg', 'pg-native', 'sharp'],
            output: {
                entryFileNames: 'main.cjs',
            },
        },
    },
});

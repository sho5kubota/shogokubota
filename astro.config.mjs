// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://shogokubota.com',
	integrations: [sitemap()],
	build: {
		inlineStylesheets: 'auto',
	},
});

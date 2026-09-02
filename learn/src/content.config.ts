import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';
import { z } from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** Small category/type label above the page title (e.g. "SAFETY", "LAB", "EXPLORER"). */
        eyebrow: z.string().optional(),
      }),
    }),
  }),
};

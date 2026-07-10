import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"

const aktuelles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/aktuelles" }),
  schema: z.object({
    titel: z.string(),
    datum: z.coerce.date(),
  }),
})

export const collections = { aktuelles }

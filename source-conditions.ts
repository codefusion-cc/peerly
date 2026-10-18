import { defaultClientConditions, defaultServerConditions, type Plugin } from 'vite'

/**
 * The export condition under which `@peerly/core` names each entry point's source. Vite, Vitest and the type check
 * (`customConditions` in tsconfig.app.json) take the source, so the app runs on core's code without building it; the
 * Worker's bundle takes `dist/`. Not the CodeFusion monorepo's `@codefusion-cc/source`: the published
 * `@codefusion-cc` packages name it too but ship no source. It becomes that condition when Peerly moves there.
 */
export const SOURCE_CONDITION = '@peerly/source'

/** Resolves workspace packages to their source in every environment of a Vite or Vitest config. */
export function packageSources(): Plugin {
  return {
    name: 'peerly-package-sources',
    configEnvironment(_name, config) {
      const conditions = config.resolve?.conditions ?? (config.consumer === 'client' ? defaultClientConditions : defaultServerConditions)
      return { resolve: { conditions: [SOURCE_CONDITION, ...conditions.filter(condition => condition !== SOURCE_CONDITION)] } }
    },
  }
}

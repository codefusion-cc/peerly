import { ArrowLeft } from 'lucide-react'
import { useI18n } from '../i18nContext.tsx'
import { legalDocs, type LegalDocId } from './legalContent.ts'

/** Static, public legal page (Privacy Policy / Terms) in the current locale. */
export function LegalPage({ doc, onBack }: { doc: LegalDocId; onBack(): void }) {
  const { t, locale } = useI18n()
  const content = legalDocs[locale][doc]

  return (
    <div className="min-h-full bg-base-100 text-base-content">
      <main id="content" className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        <button type="button" className="btn btn-ghost btn-sm mb-6" onClick={onBack} data-testid="legal-back">
          <ArrowLeft className="size-4" aria-hidden="true" />{t.back}
        </button>

        <article className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-2 p-6 md:p-10">
            <h1 className="text-3xl font-bold">{content.title}</h1>
            <p className="text-sm text-base-content/60">{content.updated}</p>
            <p className="mt-2 text-base-content/90">{content.intro}</p>

            {content.sections.map(section => (
              <section key={section.heading} className="mt-6">
                <h2 className="text-lg font-semibold">{section.heading}</h2>
                <div className="mt-2 space-y-3 text-sm leading-relaxed text-base-content/80">
                  {section.blocks.map((block, i) => {
                    if ('ul' in block) {
                      return (
                        <ul key={i} className="list-disc space-y-1 pl-5">
                          {block.ul.map((item, j) => (
                            <li key={j}>{item}</li>
                          ))}
                        </ul>
                      )
                    }
                    if ('note' in block) {
                      return (
                        <p key={i} className="rounded-box border border-success/40 bg-success/10 px-4 py-3 text-success-content/90">
                          {block.note}
                        </p>
                      )
                    }
                    return <p key={i}>{block.p}</p>
                  })}
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </div>
  )
}

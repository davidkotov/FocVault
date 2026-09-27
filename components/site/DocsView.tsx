'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { docs, type DocArticle, type DocBlock } from '@/lib/docs/content'
import { siteMessages } from '@/lib/i18n/messages/site'

function Block({ b }: { b: DocBlock }) {
  switch (b.t) {
    case 'p':
      return <p>{b.x}</p>
    case 'h':
      return <h2>{b.x}</h2>
    case 'ul':
      return (
        <ul>
          {b.x.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol>
          {b.x.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      )
    case 'code':
      return (
        <pre>
          <code>{b.x}</code>
        </pre>
      )
    case 'note':
      return <div className="docnote">{b.x}</div>
    case 'table':
      return (
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr>
                {b.head.map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

const text = (a: DocArticle) =>
  [a.title, a.summary, ...a.blocks.flatMap(b => (b.t === 'table' ? [...b.head, ...b.rows.flat()] : Array.isArray(b.x) ? b.x : [b.x]))].join(' ').toLowerCase()

/** Dokumentation: Navigation links, Artikel rechts (oder Übersicht). */
export default function DocsView({ slug }: { slug?: string }) {
  const m = useMessages(siteMessages).docs
  const { locale, path } = useI18n()
  const list = docs[locale === 'en' ? 'en' : 'de']
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.trim() ? list.filter(a => text(a).includes(q.trim().toLowerCase())) : list), [q, list])
  const groups = [...new Set(hits.map(a => a.group))]
  const article = slug ? list.find(a => a.slug === slug) : undefined

  return (
    <div className="landing sitepage">
      <SiteHeader />
      <main className="docswrap" id="main">
        <aside className="docsnav">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={m.search} aria-label={m.search} />
          {groups.map(g => (
            <div key={g}>
              <div className="docsgroup">{g}</div>
              {hits
                .filter(a => a.group === g)
                .map(a => (
                  <Link key={a.slug} href={path(`/docs/${a.slug}`)} className={a.slug === slug ? 'active' : undefined}>
                    {a.title}
                  </Link>
                ))}
            </div>
          ))}
          {hits.length === 0 && <p className="hint">{m.noMatch}</p>}
        </aside>
        <section className="docscontent">
          {article ? (
            <article>
              <Link href={path('/docs')} className="docsback">
                {m.back}
              </Link>
              <div className="kicker">{article.group}</div>
              <h1>{article.title}</h1>
              <p className="lead">{article.summary}</p>
              {article.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </article>
          ) : (
            <>
              <div className="kicker">{m.eyebrow}</div>
              <h1>{m.title}</h1>
              <p className="lead">{m.lead}</p>
              <div className="doccards">
                {hits.map(a => (
                  <Link key={a.slug} href={path(`/docs/${a.slug}`)} className="supportcard">
                    <span className="docsgroup">{a.group}</span>
                    <strong>{a.title}</strong>
                    <span>{a.summary}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="docshelp">
            {m.help} <Link href={path('/support')}>{m.helpCta} →</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { Icon, type IconName } from '@/components/site/Icons'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { securityMessages } from '@/lib/i18n/messages/security'

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('')

/** Live: Text im Browser mit AES-256-GCM verschlüsseln (Schlüssel nur in diesem Tab). */
function TryIt({ m }: { m: (typeof securityMessages)['de']['try'] }) {
  const [text, setText] = useState(m.sample)
  const [key, setKey] = useState<{ k: CryptoKey; raw: string } | null>(null)
  const [out, setOut] = useState<{ iv: string; ct: string; n: number } | null>(null)
  const newKey = useCallback(async () => {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k))
    setKey({ k, raw: hex(raw) })
  }, [])
  useEffect(() => {
    void newKey()
  }, [newKey])
  useEffect(() => {
    if (!key) return
    let off = false
    ;(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = new TextEncoder().encode(text)
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.k, data))
      if (!off) setOut({ iv: hex(iv), ct: hex(ct), n: data.byteLength })
    })()
    return () => {
      off = true
    }
  }, [text, key])
  return (
    <div className="sectry">
      <div className="secpane you">
        <div className="secpanehead">
          <Icon name="eye" size={16} /> {m.you}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder={m.placeholder} rows={5} maxLength={600} aria-label={m.you} />
        <div className="seckv">
          <span>{m.key}</span>
          <code className="blur">{key?.raw ?? '…'}</code>
        </div>
        <button className="small" onClick={() => void newKey()}>
          {m.newKey}
        </button>
      </div>
      <div className="secarrow" aria-hidden="true">
        <span />
        <Icon name="lock" size={18} />
        <span />
      </div>
      <div className="secpane server">
        <div className="secpanehead">
          <Icon name="eyeOff" size={16} /> {m.server}
        </div>
        <pre className="secct" aria-live="polite">{out?.ct ?? '…'}</pre>
        <div className="seckv">
          <span>{m.iv}</span>
          <code>{out?.iv ?? '…'}</code>
        </div>
        <div className="seckv">
          <span>{m.keyShort}</span>
          <code className="dim">— {m.hidden} —</code>
        </div>
        <div className="hint light">{out ? fmt(m.bytes, { n: out.n }) : ''}</div>
      </div>
    </div>
  )
}

/** Schritt-Animation: hebt nacheinander einen Schritt hervor (Schleife). */
function useStepper(n: number, ms: number) {
  const [i, setI] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current = setInterval(() => setI(x => (x + 1) % n), reduce ? ms * 3 : ms)
    return () => {
      if (ref.current) clearInterval(ref.current)
    }
  }, [n, ms])
  return i
}

function KeyChain({ m }: { m: (typeof securityMessages)['de']['keys'] }) {
  const active = useStepper(m.steps.length, 1300)
  const icons: IconName[] = ['key', 'activity', 'lock', 'vault', 'file', 'proof']
  return (
    <>
      <div className="seckeys">
        {m.steps.map((s, i) => (
          <div key={s.t} className={`seckey${i <= active ? ' on' : ''}${i === active ? ' now' : ''}`}>
            <div className="seckeyicon">
              <Icon name={icons[i]} size={20} />
            </div>
            <strong>{s.t}</strong>
            <span>{s.d}</span>
            {i < m.steps.length - 1 && <div className={`seclink${i < active ? ' on' : ''}`} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <p className="secrecov">
        <Icon name="lifebuoy" size={16} /> {m.recovery}
      </p>
    </>
  )
}

function Pipeline({ m }: { m: (typeof securityMessages)['de']['pipe'] }) {
  const active = useStepper(m.steps.length + 1, 1500)
  const icons: IconName[] = ['lock', 'database', 'globe', 'proof']
  const [days] = useState(() => Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000)))
  const { locale } = useI18n()
  return (
    <>
      <div className="secpipe">
        {m.steps.map((s, i) => (
          <div key={s.t} className={`secstage${i < active ? ' on' : ''}${i === active - 1 ? ' now' : ''}`}>
            <div className="secstageicon">
              <Icon name={icons[i]} size={22} />
              {i === 0 && (
                <div className="secblocks" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, k) => (
                    <i key={k} style={{ animationDelay: `${k * 0.12}s` }} />
                  ))}
                </div>
              )}
            </div>
            <strong>{s.t}</strong>
            <span>{s.d}</span>
            {i < m.steps.length - 1 && (
              <div className="secflow" aria-hidden="true">
                <b />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="secdays">
        <span className="hint">{m.days}</span>
        <div>
          {days.map((d, i) => (
            <span key={i} className="secday" title={d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-CH')} style={{ animationDelay: `${i * 0.08}s` }}>
              <Icon name="check" size={11} />
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

function LinkDemo({ m }: { m: (typeof securityMessages)['de']['link'] }) {
  const step = useStepper(3, 1800)
  return (
    <div className="seclinkdemo">
      <div className="securl">
        <span className="sent">https://focvault.app/s/Xk2p9QmZ</span>
        <span className={`kept${step >= 1 ? ' glow' : ''}`}>#k=Pq7vN2…eR4</span>
      </div>
      <div className="seclinkrow">
        <div className={`seclinkbox${step >= 1 ? ' on' : ''}`}>
          <Icon name="database" size={18} />
          <div>
            <strong>FocVault-Server</strong>
            <span>/s/Xk2p9QmZ · {m.sent}</span>
          </div>
        </div>
        <div className={`seclinkbox you${step >= 2 ? ' on' : ''}`}>
          <Icon name="lock" size={18} />
          <div>
            <strong>Browser</strong>
            <span>#k=… · {m.kept}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** /sicherheit – Architektur, Live-Verschlüsselung, Transparenz, Meldestelle. */
export default function SecurityPage() {
  const m = useMessages(securityMessages)
  return (
    <div className="landing v2 secpage">
      <SiteHeader />
      <header className="sechero">
        <div className="wrap">
          <div className="v2kicker light">{m.kicker}</div>
          <h1>{m.title}</h1>
          <p>{m.lead}</p>
        </div>
      </header>

      <section className="v2section">
        <div className="wrap">
          <div className="v2kicker center">{m.try.kicker}</div>
          <h2 className="v2title">{m.try.title}</h2>
          <p className="v2sub">{m.try.lead}</p>
          <TryIt m={m.try} />
        </div>
      </section>

      <section className="v2section tinted">
        <div className="wrap">
          <div className="v2kicker center">{m.keys.kicker}</div>
          <h2 className="v2title">{m.keys.title}</h2>
          <p className="v2sub">{m.keys.lead}</p>
          <KeyChain m={m.keys} />
        </div>
      </section>

      <section className="v2section">
        <div className="wrap">
          <div className="v2kicker center">{m.pipe.kicker}</div>
          <h2 className="v2title">{m.pipe.title}</h2>
          <Pipeline m={m.pipe} />
        </div>
      </section>

      <section className="v2section tinted">
        <div className="wrap narrow">
          <div className="v2kicker center">{m.link.kicker}</div>
          <h2 className="v2title">{m.link.title}</h2>
          <p className="v2sub">{m.link.lead}</p>
          <LinkDemo m={m.link} />
        </div>
      </section>

      <section className="v2section">
        <div className="wrap">
          <div className="v2kicker center">{m.sees.kicker}</div>
          <h2 className="v2title">{m.sees.title}</h2>
          <div className="secsees">
            <div className="v2card">
              <strong>
                <Icon name="eye" size={16} /> {m.sees.yesTitle}
              </strong>
              <ul>
                {m.sees.yes.map(x => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div className="v2card dark">
              <strong>
                <Icon name="eyeOff" size={16} /> {m.sees.noTitle}
              </strong>
              <ul>
                {m.sees.no.map(x => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="v2kicker center" style={{ marginTop: 70 }}>
            {m.table.kicker}
          </div>
          <h2 className="v2title">{m.table.title}</h2>
          <div className="tablewrap narrowtable">
            <table className="v2compare">
              <thead>
                <tr>
                  {m.table.head.map(h => (
                    <th key={h} style={{ textAlign: 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.table.rows.map(r => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td>
                    <td style={{ textAlign: 'left' }}>
                      <code>{r[1]}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="v2section tinted" id="melden">
        <div className="wrap narrow">
          <div className="v2kicker center">{m.report.kicker}</div>
          <h2 className="v2title">{m.report.title}</h2>
          <p className="v2sub">{m.report.lead}</p>
          <div className="v2ctas">
            <a className="button" href={`mailto:${m.report.email}`}>
              <Icon name="mail" size={15} /> {m.report.email}
            </a>
            <a className="button" href="/.well-known/security.txt">
              {m.report.txt}
            </a>
          </div>
          <p className="v2note">{m.report.scope}</p>
          <p className="v2note">{m.report.audit}</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}

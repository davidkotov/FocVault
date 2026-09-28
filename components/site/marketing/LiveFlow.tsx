'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/site/Icons'
import { landing2Messages } from '@/lib/i18n/messages/landing2'

type M = (typeof landing2Messages)['de']

/**
 * Archiv (Marketing): Live-Animation „Verschlüsselung im Browser“ aus der Landingpage v2.
 * Nicht mehr auf der Startseite, gedacht für Marketing- und Kampagnenseiten.
 * Nutzung: <LiveFlow m={useMessages(landing2Messages).alps} />
 */
export default function LiveFlow({ m }: { m: M['alps'] }) {
  const files: Array<[string, string]> = [
    ['Jahresabschluss_2026.pdf', '4.8 MB'],
    ['Pass_Scan.jpg', '2.1 MB'],
    ['Kundendaten_Q3.xlsx', '860 KB'],
    ['Hochzeit_Video.mov', '1.4 GB']
  ]
  const [n, setN] = useState(0)
  const [step, setStep] = useState(-1)
  const [pct, setPct] = useState(0)
  const [toast, setToast] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sleep = (ms: number) => new Promise(r => setTimeout(r, reduce ? ms * 3 : ms))
    ;(async () => {
      for (let k = 0; alive.current; k++) {
        setN(k % files.length)
        setToast(false)
        setStep(-1)
        setPct(0)
        await sleep(500)
        for (let i = 0; i < 4 && alive.current; i++) {
          setStep(i)
          const from = [0, 35, 70, 90][i]
          const to = [35, 70, 90, 100][i]
          for (let p = from; p <= to && alive.current; p += 5) {
            setPct(p)
            await sleep(55)
          }
          await sleep(350)
        }
        setStep(4)
        await sleep(600)
        setToast(true)
        await sleep(2800)
      }
    })()
    return () => {
      alive.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [name, size] = files[n]
  const nav: Array<[IconName, string, boolean?]> = [
    ['cloud', 'Meine Cloud', true],
    ['send', 'Secure Send'],
    ['key', 'Passwörter'],
    ['note', 'Notizen'],
    ['vault', 'Geteilte Tresore'],
    ['admin', 'Admin-Konsole']
  ]
  const code = ['AES-256-GCM', 'eu-west-1', '2 Anbieter', 'PDP ✓']
  return (
    <div className="v2dashcol">
      <div className="v2dash">
        <div className="v2chrome">
          <i />
          <i />
          <i />
          <span className="v2url">
            <Icon name="lock" size={11} /> focvault.app/app
          </span>
        </div>
        <div className="v2app">
          <div className="v2side">
            {nav.map(([i, l, on]) => (
              <div key={l} className={on ? 'on' : undefined}>
                <Icon name={i} size={15} />
                {l}
              </div>
            ))}
          </div>
          <div className="v2main">
            <div className="v2mh">
              <strong>Meine Cloud</strong>
              <span className="v2btn">+ {m.upload}</span>
            </div>
            <div className="v2job">
              <div className="v2jobtop">
                <div className="v2jobfile">
                  <Icon name="file" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="v2jobname">{name}</div>
                  <div className="v2jobmeta">
                    {size} · {step >= 4 ? `${m.secured} ${new Date().toLocaleDateString('de-CH')}` : m.processing}
                  </div>
                </div>
                <div className="v2jobmeta">{pct} %</div>
              </div>
              <div className="v2bar">
                <b style={{ width: `${pct}%` }} />
              </div>
              <div className="v2steps">
                {m.steps.map((s, i) => (
                  <div key={s} className={`v2step${step > i ? ' done' : step === i ? ' active' : ''}`}>
                    <span className="dot">{step > i && <Icon name="check" size={11} />}</span>
                    {s}
                    <code>{code[i]}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="v2files three">
              {(
                [
                  ['file', 'Vertrag_Mieter.pdf', '#e8f3ff'],
                  ['image', 'Ferien_Zermatt.jpg', '#fdecec'],
                  ['archive', 'Backup_Server.tar', '#eaf8ef']
                ] as Array<[IconName, string, string]>
              ).map(([i, f, c]) => (
                <div className="v2file" key={f}>
                  <div className="v2thumb small" style={{ background: c }}>
                    <Icon name={i} size={16} />
                  </div>
                  <div className="v2fn">{f}</div>
                  <div className="v2ok">Filecoin ✓</div>
                </div>
              ))}
            </div>
            <div className={`v2toast${toast ? ' show' : ''}`}>
              <Icon name="send" size={15} />
              <div>
                <div>{m.link}</div>
                <div className="k">focvault.app/s/Xk2…#•••• · {m.linkMeta}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="v2caption">{m.caption}</div>
    </div>
  )
}


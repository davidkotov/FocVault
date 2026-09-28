'use client'

import { useEffect, useState } from 'react'

const SAMPLES = ['Steuererklärung_2026.pdf', 'Passwort: ••••••••', 'Mietvertrag Zürich', 'Backup /var/lib/postgres', 'Ferien_Zermatt.jpg']
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Echte AES-256-GCM-Verschlüsselung im Browser – jede Runde neuer Schlüssel und IV. */
export function EncryptVisual({ label }: { label: { plain: string; cipher: string } }) {
  const [i, setI] = useState(0)
  const [out, setOut] = useState<{ iv: string; ct: string } | null>(null)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let alive = true
    const text = SAMPLES[i % SAMPLES.length]
    void (async () => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
      if (alive) {
        setOut({ iv: hex(iv), ct: hex(ct) })
        setShown(0)
      }
    })()
    const t = setTimeout(() => setI(n => n + 1), 3600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [i])
  useEffect(() => {
    if (!out) return
    if (reduced()) return setShown(out.ct.length)
    if (shown >= out.ct.length) return
    const t = setTimeout(() => setShown(n => Math.min(out.ct.length, n + 4)), 22)
    return () => clearTimeout(t)
  }, [out, shown])
  return (
    <div className="bv bv-enc" aria-hidden="true">
      <div className="bv-row">
        <span className="bv-k">{label.plain}</span>
        <span className="bv-plain">{SAMPLES[i % SAMPLES.length]}</span>
      </div>
      <div className="bv-arrow">
        <span>AES-256-GCM</span>
      </div>
      <div className="bv-row">
        <span className="bv-k">{label.cipher}</span>
        <span className="bv-ct">
          {out ? out.ct.slice(0, shown) : ''}
          <i className="bv-caret" />
        </span>
      </div>
      <div className="bv-foot">IV {out ? out.iv.slice(0, 12) : '············'}…</div>
    </div>
  )
}

/** Eine Datei, drei unabhängige Speicherorte – Pakete wandern zu jedem Knoten. */
export function ReplicaVisual({ nodes }: { nodes: [string, string, string] }) {
  return (
    <div className="bv bv-rep" aria-hidden="true">
      <svg viewBox="0 0 300 120" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bvline" x1="0" x2="1">
            <stop offset="0" stopColor="#0090ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#0090ff" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {[20, 64, 108].map((y, k) => (
          <g key={y}>
            <path d={`M44 64 C 150 64, 190 ${y}, 300 ${y}`} fill="none" stroke="url(#bvline)" strokeWidth="1.5" />
            <circle r="3.2" fill="#0090ff">
              <animateMotion dur="2.4s" begin={`${k * 0.5}s`} repeatCount="indefinite" path={`M44 64 C 150 64, 190 ${y}, 300 ${y}`} />
              <animate attributeName="opacity" values="0;1;1;0" dur="2.4s" begin={`${k * 0.5}s`} repeatCount="indefinite" />
            </circle>
          </g>
        ))}
      </svg>
      <span className="bv-file">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M6 2h8l6 6v14H6z M14 2v6h6" fill="none" stroke="#fff" strokeWidth="1.6" />
        </svg>
      </span>
      <div className="bv-nodes">
        {nodes.map((n, k) => (
          <span key={n} style={{ animationDelay: `${k * 0.5 + 1.6}s` }}>
            <i />
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Beweis-Zyklus: Challenge → Beweis → geprüft, dann nächste Runde. */
export function ProofVisual({ steps, next }: { steps: [string, string, string]; next: string }) {
  const [phase, setPhase] = useState(0)
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT(x => (x + 1) % 60), 100)
    return () => clearInterval(id)
  }, [])
  useEffect(() => setPhase(t < 15 ? 0 : t < 30 ? 1 : 2), [t])
  const pct = t / 60
  return (
    <div className="bv bv-proof" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="bv-ring">
        <circle cx="22" cy="22" r="18" fill="none" stroke="#e3eaf3" strokeWidth="3" />
        <circle cx="22" cy="22" r="18" fill="none" stroke="#0090ff" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${pct * 113} 113`} transform="rotate(-90 22 22)" />
        <path d="M15 22.5l4.5 4.5L29 17" fill="none" stroke={phase === 2 ? '#148a52' : '#c9d3df'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <ol>
        {steps.map((s, k) => (
          <li key={s} className={k < phase ? 'done' : k === phase ? 'now' : ''}>
            <span />
            {s}
          </li>
        ))}
      </ol>
      <div className="bv-foot">{next}</div>
    </div>
  )
}

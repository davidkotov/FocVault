'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const GAP = 8
const EDGE = 8

/** Anker eines Tooltips: Element mit `data-tip` – bei gesperrten Navigationspunkten die ganze Zeile. */
function anchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const direct = target.closest<HTMLElement>('[data-tip]')
  if (direct?.dataset.tip) return direct
  return target.closest('.navitem.locked, .navitem.disabled')?.querySelector<HTMLElement>('[data-tip]') ?? null
}

/**
 * Eine Tooltip-Ebene für alle `data-tip`-Elemente: fest positioniert am Ende von <body> und damit
 * nie von `overflow` oder Stacking-Kontexten (Sidebar, Karten, Tabellen) abgeschnitten.
 * Bevorzugt unter dem Element, sonst darüber; horizontal immer im sichtbaren Bereich.
 */
export default function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const show = (a: HTMLElement) => {
      if (anchorRef.current === a) return
      anchorRef.current = a
      setPos(null)
      setTip({ text: a.dataset.tip ?? '', rect: a.getBoundingClientRect() })
    }
    const hide = () => {
      anchorRef.current = null
      setTip(null)
    }
    const onOver = (e: Event) => {
      const a = anchorOf(e.target)
      if (a) show(a)
      else if (anchorRef.current) hide()
    }
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) hide()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onOver)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('focusin', onOver)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!tip || !box) return
    const { width, height } = box.getBoundingClientRect()
    const r = tip.rect
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const below = r.bottom + GAP + height <= vh - EDGE || r.top - GAP - height < EDGE
    const top = below ? r.bottom + GAP : r.top - GAP - height
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, EDGE), vw - width - EDGE)
    setPos({ left, top })
  }, [tip])

  if (!tip?.text) return null
  return (
    <div
      ref={boxRef}
      className={`tiplayer${pos ? ' on' : ''}`}
      role="tooltip"
      aria-hidden="true"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0 }}
    >
      {tip.text}
    </div>
  )
}

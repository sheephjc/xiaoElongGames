import { useLayoutEffect, useRef, type ReactNode } from 'react'

interface SidebarInfoStackProps {
  children: ReactNode
}

const watermarkTop = -14

export function SidebarInfoStack({ children }: SidebarInfoStackProps) {
  const stackRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const stack = stackRef.current
    if (!stack) return

    const cards = Array.from(stack.querySelectorAll<HTMLElement>('.info-card'))
    const alignWatermarkSlices = () => {
      for (const card of cards) {
        card.style.setProperty('--yi-offset', `${watermarkTop - card.offsetTop}px`)
      }
    }

    alignWatermarkSlices()
    window.addEventListener('resize', alignWatermarkSlices)

    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(alignWatermarkSlices)
    observer?.observe(stack)
    cards.forEach((card) => observer?.observe(card))

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', alignWatermarkSlices)
    }
  }, [])

  return (
    <div className="sidebar-info-stack" ref={stackRef}>
      {children}
    </div>
  )
}

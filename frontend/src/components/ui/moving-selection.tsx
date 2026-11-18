import { useLayoutEffect, useRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function useMovingSelection() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    const update = () => {
      const active = container.querySelector<HTMLElement>(':scope > [data-state="active"], :scope > [aria-pressed="true"]')
      if (!active?.offsetWidth) return
      container.style.setProperty('--selection-x', `${active.offsetLeft}px`)
      container.style.setProperty('--selection-y', `${active.offsetTop}px`)
      container.style.setProperty('--selection-width', `${active.offsetWidth}px`)
      container.style.setProperty('--selection-height', `${active.offsetHeight}px`)
      container.dataset.movingReady = 'true'
    }
    const resize = new ResizeObserver(update)
    const observe = () => {
      container.querySelectorAll('button').forEach(button => resize.observe(button))
      update()
    }
    resize.observe(container)
    const mutations = new MutationObserver(observe)
    mutations.observe(container, { subtree:true, childList:true, attributes:true, attributeFilter:['data-state','aria-pressed'] })
    observe()
    return () => { resize.disconnect(); mutations.disconnect() }
  }, [])
  return ref
}

export function SegmentedControl({ className, children, ...props }: ComponentProps<'div'>) {
  const ref = useMovingSelection()
  return <div {...props} ref={ref} className={cn('ui-segmented', className)}><span className="ui-moving-indicator" aria-hidden="true"/>{children}</div>
}

import { useCallback, useRef } from 'react'

export function useEventLog() {
  const logRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<string[]>([])
  const startRef = useRef(performance.now())

  const log = useCallback((msg: string) => {
    const t = ((performance.now() - startRef.current) / 1000).toFixed(2)
    linesRef.current.push(`${t}s ${msg}`)
    if (linesRef.current.length > 60) linesRef.current.shift()
    const el = logRef.current
    if (el) {
      el.textContent = linesRef.current.join('\n')
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const clear = useCallback(() => {
    linesRef.current = []
    startRef.current = performance.now()
    if (logRef.current) logRef.current.textContent = ''
  }, [])

  return { logRef, log, clear }
}

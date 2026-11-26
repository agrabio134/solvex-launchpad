import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { explorerTx } from '../lib/config'

type Kind = 'ok' | 'err' | 'info'
interface T {
  id: number
  kind: Kind
  text: string
  sig?: string
}
const Ctx = createContext<(kind: Kind, text: string, sig?: string) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((kind: Kind, text: string, sig?: string) => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s, { id, kind, text, sig }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'err' ? 12000 : 7000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            {t.sig && (
              <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                view tx ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

import React from 'react'

/**
 * Right-anchored slide-over drawer. Overlay closes on backdrop click; the panel
 * stops propagation. Adapts the AvizierPanel overlay pattern into a drawer.
 */
export function DrawerShell({
  open,
  title,
  onClose,
  children,
  width = 460,
}: {
  open: boolean
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `min(${width}px, 96vw)`,
          height: '100%',
          maxHeight: '100%',
          overflow: 'auto',
          borderRadius: 0,
          background: 'var(--bg, #fff)',
          boxShadow: '-8px 0 30px rgba(0,0,0,0.25)',
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost small" type="button" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

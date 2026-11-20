import type React from 'react'

// Shared look of the cards on the association dashboard (Acasă → Today): the big collapsible
// section cards, their small inner cards and the round +/− toggle. TodayHome's money cards and the
// services card both use these, so the page stays visually consistent.

export const outerCardStyle: React.CSSProperties = {
  background: 'var(--bg, #fff)', border: '1px solid var(--border, #e5e5e5)', borderRadius: 16,
  padding: '18px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}
export const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #737373)', fontWeight: 500,
}
export const bigNumberStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 6 }
export const collapseBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 999, border: '1px solid var(--border, #e5e5e5)', background: '#eceef1',
  color: 'var(--text, #1d1d1f)', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0,
}
export const innerCardStyle: React.CSSProperties = {
  background: '#eceef1', border: '1px solid var(--border, #e5e5e5)', borderRadius: 12, padding: 14,
}

import React from 'react'

type Props = { children: React.ReactNode }
type State = { error: Error | null }

/**
 * Top-level error boundary. Without one, any render-time throw unmounts the whole React tree and the
 * page goes completely blank (with only a console error) — which is exactly how a single bad component
 * can hide the entire app. This catches such throws and shows the error + a reload instead.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 24, maxWidth: 760, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>Ceva n-a mers bine</h2>
        <p style={{ color: '#666' }}>
          Aplicația a întâmpinat o eroare neașteptată. Detaliile de mai jos ajută la depanare.
        </p>
        <pre style={{ background: '#f6f6f7', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {error.message}
          {error.stack ? '\n\n' + error.stack : ''}
        </pre>
        <button
          type="button"
          onClick={() => { this.setState({ error: null }); window.location.reload() }}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}
        >
          Reîncarcă
        </button>
      </div>
    )
  }
}

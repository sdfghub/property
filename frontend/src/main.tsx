import React from 'react'
// Entry point mounting the SPA.
// We keep this minimal: StrictMode + root App.
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

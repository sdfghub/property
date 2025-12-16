import React from 'react'
import { CommunityConfigViewer } from '../CommunityConfigViewer'

type Props = {
  configJson: any
  metersConfig?: any
  configError: string | null
  loadingLabel: string
}

export function ConfigTab({ configJson, metersConfig, configError, loadingLabel }: Props) {
  return (
    <div className="stack">
      {configError && <div className="badge negative">{configError}</div>}
      {!configError && !configJson && <div className="muted">{loadingLabel}</div>}
      {configJson && <CommunityConfigViewer config={configJson} metersConfig={metersConfig} />}
    </div>
  )
}

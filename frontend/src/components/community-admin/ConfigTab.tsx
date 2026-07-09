import { CommunityConfigViewer } from '../CommunityConfigViewer'
import { PaymentAllocationPanel } from './PaymentAllocationPanel'
import { MeasureModePanel } from './MeasureModePanel'
import { PeriodSettingsPanel } from './PeriodSettingsPanel'

type Props = {
  communityId: string
  configJson: any
  metersConfig?: any
  configError: string | null
  loadingLabel: string
  readOnly?: boolean
}

export function ConfigTab({ communityId, configJson, metersConfig, configError, loadingLabel, readOnly }: Props) {
  return (
    <div className="stack">
      {communityId && <PeriodSettingsPanel communityId={communityId} readOnly={readOnly} />}
      {communityId && <PaymentAllocationPanel communityId={communityId} />}
      {communityId && <MeasureModePanel communityId={communityId} />}
      {configError && <div className="badge negative">{configError}</div>}
      {!configError && !configJson && <div className="muted">{loadingLabel}</div>}
      {configJson && <CommunityConfigViewer config={configJson} metersConfig={metersConfig} />}
    </div>
  )
}

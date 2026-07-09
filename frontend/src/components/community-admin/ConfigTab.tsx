import { CommunityConfigViewer } from '../CommunityConfigViewer'
import { PaymentAllocationPanel } from './PaymentAllocationPanel'
import { MeasureModePanel } from './MeasureModePanel'

type Props = {
  communityId: string
  configJson: any
  metersConfig?: any
  configError: string | null
  loadingLabel: string
}

export function ConfigTab({ communityId, configJson, metersConfig, configError, loadingLabel }: Props) {
  return (
    <div className="stack">
      {communityId && <PaymentAllocationPanel communityId={communityId} />}
      {communityId && <MeasureModePanel communityId={communityId} />}
      {configError && <div className="badge negative">{configError}</div>}
      {!configError && !configJson && <div className="muted">{loadingLabel}</div>}
      {configJson && <CommunityConfigViewer config={configJson} metersConfig={metersConfig} />}
    </div>
  )
}

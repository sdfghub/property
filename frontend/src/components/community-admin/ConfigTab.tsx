import { CommunityConfigViewer } from '../CommunityConfigViewer'
import { PaymentAllocationPanel } from './PaymentAllocationPanel'
import { MeasureModePanel } from './MeasureModePanel'
import { StructurePanel } from './StructurePanel'
import { AvizierConfigPanel } from './AvizierConfigPanel'
import { AssociationSettingsPanel } from './AssociationSettingsPanel'

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
      {communityId && <AssociationSettingsPanel communityId={communityId} />}
      {communityId && <PaymentAllocationPanel communityId={communityId} />}
      {communityId && <MeasureModePanel communityId={communityId} />}
      {communityId && <StructurePanel communityId={communityId} />}
      {communityId && <AvizierConfigPanel communityId={communityId} />}
      {configError && <div className="badge negative">{configError}</div>}
      {!configError && !configJson && <div className="muted">{loadingLabel}</div>}
      {configJson && <CommunityConfigViewer config={configJson} metersConfig={metersConfig} />}
    </div>
  )
}

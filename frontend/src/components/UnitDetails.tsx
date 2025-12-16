import React from 'react'
import { useI18n } from '../i18n/useI18n'

type Unit = {
  id: string
  code: string
  beCodes?: string[]
}

type GroupRef = {
  id: string
  code: string
  name?: string
}

type Meter = {
  meterId: string
  typeCode: string
  origin?: string | null
  scopeType?: string
  scopeCode?: string
}

type Props = {
  unit: Unit
  groupCodes?: string[]
  groups?: GroupRef[]
  meters?: Meter[]
}

export function UnitDetails({ unit, groupCodes = [], groups = [], meters = [] }: Props) {
  const { t } = useI18n()
  const groupLabels = groupCodes
    .map((c) => groups.find((g) => g.id === c || g.code === c)?.name || c)
    .filter(Boolean)
  const beCodes = unit.beCodes ?? []
  const unitMeters = meters.filter((m) => m.scopeType === 'UNIT' && m.scopeCode === unit.code)

  return (
    <div className="card soft">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h4>{unit.code}</h4>
        </div>
      </div>
      {groupLabels.length > 0 && (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('config.unitGroupsLabel')}: {groupLabels.join(', ')}
        </div>
      )}
      {beCodes.length > 0 && (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('config.unitBe')}: {beCodes.join(', ')}
        </div>
      )}
      {unitMeters.length > 0 && (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('config.unitMeters')}:{' '}
          {unitMeters
            .map((m) => `${m.meterId} (${m.typeCode}${m.origin ? ` · ${m.origin}` : ''})`)
            .join(', ')}
        </div>
      )}
    </div>
  )
}

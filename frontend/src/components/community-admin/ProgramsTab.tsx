import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { ProgramDetails } from '../ProgramDetails'

type Props = {
  programs: any[]
  programError: string | null
}

export function ProgramsTab({ programs, programError }: Props) {
  const { t } = useI18n()
  return (
    <div className="stack">
      {/*<h4>{t('tab.programs')}</h4>
      <p className="muted">{t('programs.subtitle')}</p>*/}
      {programError && <div className="badge negative">{programError}</div>}
      {!programError && programs.length > 0 ? (
        <div className="stack">
          {programs.map((p: any) => (
            <ProgramDetails key={p.code} program={p} />
          ))}
        </div>
      ) : (
        <div className="card soft">
          <div className="muted">{t('programs.label')}</div>
          <p className="muted">{t('programs.loadPrompt')}</p>
        </div>
      )}
    </div>
  )
}

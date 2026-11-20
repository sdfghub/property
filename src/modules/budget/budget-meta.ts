// Budget taxonomies — the source of truth for codes and labels (model de bugetare §4–7). The
// frontend renders whatever the /budget payload carries; it never maps these codes itself.

export const BUDGET_DIMENSION_META = [
  { code: 'OPERATIONAL', fm: 'FM-OPE', label: 'Operațional', hint: 'RUN – furnizarea curentă: estimarea cheltuielilor de întreținere' },
  { code: 'TACTIC', fm: 'FM-TAC', label: 'Tactic', hint: 'MAINTAIN – mentenanță preventivă și reactivă' },
  { code: 'STRATEGIC', fm: 'FM-STR', label: 'Strategic', hint: 'TRANSFORM – programe și proiecte' },
] as const

export const BUDGET_MAINTENANCE_META = [
  { code: 'PREVENTIVE', label: 'Mentenanță preventivă' },
  { code: 'REACTIVE', label: 'Mentenanță reactivă' },
] as const

/** What kind of cost a budget item is — shown on each line/project in the budget views. */
export const BUDGET_COST_TYPE_META = [
  { code: 'PROJECT', label: 'Proiect' },
  { code: 'CONSUMPTION', label: 'Consum' },
  { code: 'SUBSCRIPTION', label: 'Abonament' },
  { code: 'PREVENTIVE_MAINTENANCE', label: 'Mentenanță preventivă' },
  { code: 'REPAIR', label: 'Reparație' },
  { code: 'COMPLIANCE', label: 'Conformitate' },
  { code: 'FEES', label: 'Comisioane' },
  { code: 'SUPPLIES', label: 'Consumabile' },
  { code: 'FUND', label: 'Constituire fond' },
] as const

export const BUDGET_LINE_STATUS_META = [
  { code: 'PROPOSED', label: 'Propus' },
  { code: 'TO_CONFIRM', label: 'De confirmat' },
  { code: 'APPROVED', label: 'Aprobat' },
  { code: 'CONTRACTED', label: 'Contractat' },
  { code: 'IN_EXECUTION', label: 'În execuție' },
  { code: 'CLOSED', label: 'Închis' },
] as const

export const BUDGET_ENTRY_KIND_META = [
  { code: 'ESTIMATE', label: 'Estimare / buget' },
  { code: 'COMMITMENT', label: 'Angajament (contract, act adițional, deviz)' },
  { code: 'PAYMENT', label: 'Plată' },
] as const

/** Service catalogue S01–S12 (subservices used by the budget). */
export const BUDGET_SERVICE_META: Array<{ code: string; label: string }> = [
  { code: 'S01-01', label: 'Control acces' },
  { code: 'S01-03', label: 'Supraveghere și pază' },
  { code: 'S02-01', label: 'Prevenire incendii' },
  { code: 'S02-03', label: 'Protecție la trăsnet' },
  { code: 'S02-04', label: 'Siguranța instalațiilor' },
  { code: 'S02-05', label: 'Coșerit' },
  { code: 'S03-01', label: 'Iluminat interior' },
  { code: 'S04-01', label: 'Încălzire' },
  { code: 'S04-02', label: 'Răcire' },
  { code: 'S05-01', label: 'Apă' },
  { code: 'S05-02', label: 'Canalizare' },
  { code: 'S05-03', label: 'Ape meteorice' },
  { code: 'S05-04', label: 'Electricitate' },
  { code: 'S05-06', label: 'Gaze' },
  { code: 'S06-01', label: 'Curățenie' },
  { code: 'S06-02', label: 'Salubritate' },
  { code: 'S06-03', label: 'Dezinsecție, dezinfecție și deratizare' },
  { code: 'S07-01', label: 'Transport vertical (lift)' },
  { code: 'S08-01', label: 'Structură și anvelopă' },
  { code: 'S08-02', label: 'Conservare fațadă și acoperiș' },
  { code: 'S08-03', label: 'Amenajări' },
  { code: 'S09-01', label: 'Internet și date' },
  { code: 'S10-01', label: 'Administrare financiară' },
  { code: 'S10-02', label: 'Administrare tehnică și contractuală' },
]

export const BUDGET_METRIC_META = [
  { code: 'budget', label: 'Buget', hint: 'Buget curent aprobat (linia de bază).' },
  { code: 'estimate', label: 'Estimare', hint: 'Cea mai bună estimare a costului total al liniei, inclusiv lucrări din afara bugetului.' },
  { code: 'committed', label: 'Angajat', hint: 'Valoare fermă din contracte, acte adiționale și devize acceptate.' },
  { code: 'actual', label: 'Actual', hint: 'Cost înregistrat: cheltuieli repartizate în luni închise (Operațional/Tactic) sau plăți efectuate (Strategic).' },
  { code: 'remainingCommitted', label: 'Rest angajat', hint: 'Angajat − Actual.' },
  { code: 'remainingUncommitted', label: 'Rest neangajat', hint: 'Lucrări estimate fără obligație fermă sau lunile rămase estimate.' },
  { code: 'forecast', label: 'Forecast', hint: 'Actual + rest angajat + rest neangajat.' },
  { code: 'variance', label: 'Abatere', hint: 'Forecast − Buget. Pozitiv = depășire estimată.' },
] as const

export const labelOf = (list: ReadonlyArray<{ code: string; label: string }>, code?: string | null) =>
  code ? list.find((x) => x.code === code)?.label ?? code : null

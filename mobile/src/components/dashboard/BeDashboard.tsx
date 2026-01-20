import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { styles } from '../../styles/appStyles'
import { formatMoney } from '../../utils/formatters'

type BeDashboardProps = {
  beId: string
  statementLoading: boolean
  statement: { periodCode: string; dueStart: number; charges: number; currency?: string } | null
  previousPeriodCode: string | null
  previousClosedStatement: { periodCode: string; dueEnd: number; currency?: string } | null
  liveTotals: { dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number } | null
  statementDetail: { statement: any; ledgerEntries: any[] } | null
  statementDetailOpen: boolean
  setStatementDetailOpen: (next: boolean) => void
  programBuckets: Record<string, { id: string; code: string; name: string }>
  onNavigateStatement: (periodCode: string) => void
  onNavigateProgram: (programId: string) => void
  onNavigateExpenses: (periodCode: string) => void
  onAddBalance: () => void
  onAddBucket: (bucket: string, amount: number, label: string) => void
  isInCart: (beId: string, bucket?: string | null) => boolean
}

export function BeDashboard({
  beId,
  statementLoading,
  statement,
  previousPeriodCode,
  previousClosedStatement,
  liveTotals,
  statementDetail,
  statementDetailOpen,
  setStatementDetailOpen,
  programBuckets,
  onNavigateStatement,
  onNavigateProgram,
  onNavigateExpenses,
  onAddBalance,
  onAddBucket,
  isInCart,
}: BeDashboardProps) {
  return (
    <ScrollView contentContainerStyle={styles.dashboardStack}>
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>Financial situation</Text>
        {liveTotals ? (
          <>
            <Text style={styles.cardSubtle}>
              Initial due amount: {formatMoney(previousClosedStatement?.dueEnd ?? 0, previousClosedStatement?.currency || 'RON')}
            </Text>
            <Text style={styles.cardSubtle}>Charges: {formatMoney(liveTotals.charges, 'RON')}</Text>
            <Text style={styles.cardSubtle}>Payments: {formatMoney(liveTotals.payments, 'RON')}</Text>
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardRowTitle}>Due now</Text>
              <Text style={styles.cardRowValue}>{formatMoney(liveTotals.dueEnd, 'RON')}</Text>
              {liveTotals.dueEnd <= 0 ? <Text style={styles.cardSubtle}>✓</Text> : null}
              {liveTotals.dueEnd > 0 && !isInCart(beId) ? (
                <TouchableOpacity style={styles.buttonSecondarySmall} onPress={onAddBalance}>
                  <Text style={styles.buttonSecondaryText}>Add to cart</Text>
                </TouchableOpacity>
              ) : liveTotals.dueEnd > 0 ? (
                <Text style={styles.muted}>In cart</Text>
              ) : null}
            </View>
          </>
        ) : (
          <Text style={styles.muted}>No live totals yet.</Text>
        )}
      </View>
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>
          {statement?.periodCode ? `Period ${statement.periodCode}` : 'Period'}
        </Text>
        {statementLoading ? (
          <View style={styles.cardLoading}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading statement…</Text>
          </View>
        ) : statement ? (
          <>
            <Text style={styles.cardValue}>{statement.periodCode}</Text>
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardSubtle}>Starting balance:</Text>
              {previousPeriodCode && statementDetail?.statement && Number(statementDetail.statement.dueEnd || 0) !== 0 ? (
                <TouchableOpacity style={styles.valueButton} onPress={() => onNavigateStatement(previousPeriodCode)}>
                  <Text style={[styles.valueButtonText, statement.dueStart <= 0 ? styles.balanceGood : styles.balanceBad]}>
                    {statement.dueStart.toFixed(2)} {statement.currency || 'RON'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.cardSubtle, statement.dueStart <= 0 ? styles.balanceGood : styles.balanceBad]}>
                  {statement.dueStart.toFixed(2)} {statement.currency || 'RON'}
                </Text>
              )}
            </View>
            {previousClosedStatement ? (
              <Text style={styles.cardSubtle}>
                Previous closed {previousClosedStatement.periodCode}: {formatMoney(previousClosedStatement.dueEnd, previousClosedStatement.currency)}
              </Text>
            ) : (
              <Text style={styles.cardSubtle}>Previous closed: n/a</Text>
            )}
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardSubtle}>Charges this period:</Text>
              <TouchableOpacity style={styles.valueButton} onPress={() => setStatementDetailOpen(!statementDetailOpen)}>
                <Text style={styles.valueButtonText}>
                  {statement.charges.toFixed(2)} {statement.currency || 'RON'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardSubtle}>Statement:</Text>
              <TouchableOpacity style={styles.valueButton} onPress={() => onNavigateStatement(statement.periodCode)}>
                <Text style={styles.valueButtonText}>View</Text>
              </TouchableOpacity>
            </View>
            {statementDetailOpen ? (
              <View style={styles.statementDetail}>
                {statementDetail?.ledgerEntries?.length ? (
                  statementDetail.ledgerEntries
                    .filter((entry: any) => entry.kind === 'CHARGE')
                    .map((entry: any) => {
                      const program = programBuckets[entry.bucket || '']
                      const label = program?.name
                        ? program.name
                        : program?.code
                          ? program.code
                          : entry.bucket === 'ALLOCATED_EXPENSE'
                            ? 'Allocated'
                            : String(entry.bucket || 'Charge')
                    const onPress =
                      entry.bucket === 'ALLOCATED_EXPENSE' && statement?.periodCode
                        ? () => onNavigateExpenses(statement.periodCode)
                        : program?.id
                          ? () => onNavigateProgram(program.id)
                          : null
                    return (
                      <TouchableOpacity key={entry.id} style={styles.statementRow} onPress={onPress} disabled={!onPress}>
                        <View style={styles.statementRowHeader}>
                          <Text style={styles.statementRowTitle}>{label}</Text>
                          <Text style={styles.statementRowAmount}>{formatMoney(entry.amount, entry.currency)}</Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })
                ) : (
                  <Text style={styles.muted}>No charges.</Text>
                )}
              </View>
            ) : null}
            {statementDetail?.statement ? (
              <View style={styles.statementSummary}>
                <Text style={styles.cardSubtle}>
                  Payments: {formatMoney(statementDetail.statement.payments, statementDetail.statement.currency)}
                </Text>
                <Text style={styles.cardSubtle}>
                  Adjustments: {formatMoney(statementDetail.statement.adjustments, statementDetail.statement.currency)}
                </Text>
                <Text style={styles.cardSubtle}>
                  Due end: {formatMoney(statementDetail.statement.dueEnd, statementDetail.statement.currency)}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}>No closed periods yet.</Text>
        )}
      </View>
    </ScrollView>
  )
}

import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { styles } from '../../styles/appStyles'

type CartLine = { billingEntityId: string; bucket?: string | null; amount: number; label: string }

type CartPanelProps = {
  open: boolean
  lines: CartLine[]
  total: number
  submitting: boolean
  message: string | null
  beMetaMap: Record<string, { name?: string; communityId?: string }>
  onRemove: (index: number) => void
  onClear: () => void
  onSubmit: () => void
}

export function CartPanel({
  open,
  lines,
  total,
  submitting,
  message,
  beMetaMap,
  onRemove,
  onClear,
  onSubmit,
}: CartPanelProps) {
  if (!open) return null
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Cart</Text>
      {lines.length ? (
        lines.map((line, idx) => {
          const beLabel = beMetaMap[line.billingEntityId]?.name || line.billingEntityId
          const bucketLabel = line.bucket ? ` · ${line.bucket}` : ''
          return (
            <View key={`${line.billingEntityId}-${line.bucket || 'ALL'}-${idx}`} style={styles.cardRow}>
              <Text style={styles.cardRowTitle}>{beLabel}{bucketLabel}</Text>
              <Text style={styles.cardRowValue}>{Number(line.amount || 0).toFixed(2)}</Text>
              <TouchableOpacity style={styles.buttonSecondarySmall} onPress={() => onRemove(idx)}>
                <Text style={styles.buttonSecondaryText}>Remove</Text>
              </TouchableOpacity>
            </View>
          )
        })
      ) : (
        <Text style={styles.muted}>Cart is empty.</Text>
      )}
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          style={[styles.button, (submitting || !lines.length) && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={submitting || !lines.length}
        >
          <Text style={styles.buttonText}>
            {submitting ? 'Saving…' : `Checkout ${total.toFixed(2)}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonSecondarySmall} onPress={onClear}>
          <Text style={styles.buttonSecondaryText}>Clear</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

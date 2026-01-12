import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatDate } from '../utils/formatters'
export function EventDetailScreen() {
  const { api } = useAuth()
  const beScope = useBeScope()
  const communityId = beScope.beMetaMap[beScope.selectedBeId || '']?.communityId
  const route = useRoute<any>()
  const eventId = route?.params?.eventId as string | undefined
  const [event, setEvent] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [rsvpStatus, setRsvpStatus] = React.useState<string | null>(null)
  const [submittingRsvp, setSubmittingRsvp] = React.useState(false)

  const loadEvent = React.useCallback(() => {
    if (!communityId || !eventId) return
    setLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/${communityId}/events/${eventId}`)
      .then((data) => {
        setEvent(data)
        setRsvpStatus(data?.rsvpStatus ?? null)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load event'))
      .finally(() => setLoading(false))
  }, [api, communityId, eventId])

  React.useEffect(() => {
    loadEvent()
  }, [loadEvent])

  const setRsvp = async (status: string | null) => {
    if (!communityId || !eventId) return
    setSubmittingRsvp(true)
    try {
      await api.post(`/communities/${communityId}/events/${eventId}/rsvp`, { status })
      setRsvpStatus(status)
      loadEvent()
    } catch (err: any) {
      setMessage(err?.message || 'Unable to update RSVP')
    } finally {
      setSubmittingRsvp(false)
    }
  }

  return (
    <ScreenChrome title="Event">
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!communityId || !eventId ? (
        <View style={styles.listCard}>
          <Text style={styles.muted}>Event not available.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading event…</Text>
        </View>
      ) : event ? (
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>{event.title}</Text>
            {event.description ? <Text style={styles.cardSubtle}>{event.description}</Text> : null}
            <Text style={styles.cardSubtle}>{formatDate(event.startAt)} → {formatDate(event.endAt)}</Text>
            <Text style={styles.cardSubtle}>Location: {event.location || 'Not specified'}</Text>
            <View style={styles.rsvpRow}>
              <TouchableOpacity
                style={[styles.rsvpButton, rsvpStatus === 'GOING' && styles.rsvpButtonActive]}
                onPress={() => setRsvp('GOING')}
                disabled={submittingRsvp}
              >
                <Text style={[styles.rsvpButtonText, rsvpStatus === 'GOING' && styles.rsvpButtonTextActive]}>Going</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rsvpButton, rsvpStatus === 'NOT_GOING' && styles.rsvpButtonActive]}
                onPress={() => setRsvp('NOT_GOING')}
                disabled={submittingRsvp}
              >
                <Text style={[styles.rsvpButtonText, rsvpStatus === 'NOT_GOING' && styles.rsvpButtonTextActive]}>Not going</Text>
              </TouchableOpacity>
              {rsvpStatus ? (
                <TouchableOpacity
                  style={[styles.rsvpButton, styles.rsvpButtonGhost]}
                  onPress={() => setRsvp(null)}
                  disabled={submittingRsvp}
                >
                  <Text style={styles.rsvpButtonText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {Array.isArray(event.attachments) && event.attachments.length ? (
            <View style={styles.dashboardCard}>
              <Text style={styles.cardTitle}>Attachments</Text>
              {event.attachments.map((att: any, idx: number) => (
                <Text key={att?.id || idx} style={styles.cardRowMeta}>
                  {att?.name || att?.fileName || att?.url || 'Attachment'}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.listCard}>
          <Text style={styles.muted}>No event data.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}

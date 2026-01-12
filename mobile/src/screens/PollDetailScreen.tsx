import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatDate } from '../utils/formatters'
export function PollDetailScreen() {
  const { api } = useAuth()
  const beScope = useBeScope()
  const communityId = beScope.beMetaMap[beScope.selectedBeId || '']?.communityId
  const route = useRoute<any>()
  const pollId = route?.params?.pollId as string | undefined
  const [poll, setPoll] = React.useState<any | null>(null)
  const [selectedOptions, setSelectedOptions] = React.useState<string[]>([])
  const [submittedOptions, setSubmittedOptions] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [voteStatus, setVoteStatus] = React.useState<string | null>(null)
  const [submittingVote, setSubmittingVote] = React.useState(false)

  const loadPoll = React.useCallback(() => {
    if (!communityId || !pollId) return
    setLoading(true)
    setMessage(null)
    setVoteStatus(null)
    api
      .get<any>(`/communities/${communityId}/polls/${pollId}`)
      .then((data) => {
        setPoll(data)
        const chosen = Array.isArray(data?.userVoteOptionIds) ? data.userVoteOptionIds : []
        setSelectedOptions(chosen)
        setSubmittedOptions(chosen)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load poll'))
      .finally(() => setLoading(false))
  }, [api, communityId, pollId])

  React.useEffect(() => {
    loadPoll()
  }, [loadPoll])

  const canVote = poll
    ? poll.status === 'APPROVED' &&
      !poll.closedAt &&
      new Date(poll.startAt).getTime() <= Date.now() &&
      new Date(poll.endAt).getTime() >= Date.now()
    : false

  const toggleOption = (id: string) => {
    if (!poll) return
    if (poll.allowsMultiple) {
      setSelectedOptions((prev) => (prev.includes(id) ? prev.filter((opt) => opt !== id) : [...prev, id]))
      return
    }
    setSelectedOptions([id])
  }

  const submitVote = async () => {
    if (!communityId || !pollId || !selectedOptions.length) return
    setSubmittingVote(true)
    setVoteStatus(null)
    try {
      await api.post(`/communities/${communityId}/polls/${pollId}/vote`, { optionIds: selectedOptions })
      setVoteStatus('Vote saved.')
      loadPoll()
    } catch (err: any) {
      setVoteStatus(err?.message || 'Unable to submit vote')
    } finally {
      setSubmittingVote(false)
    }
  }

  const removeVote = async () => {
    if (!communityId || !pollId) return
    setSubmittingVote(true)
    setVoteStatus(null)
    try {
      await api.post(`/communities/${communityId}/polls/${pollId}/vote`, { optionIds: [] })
      setSelectedOptions([])
      setSubmittedOptions([])
      setVoteStatus('Vote removed.')
      loadPoll()
    } catch (err: any) {
      setVoteStatus(err?.message || 'Unable to remove vote')
    } finally {
      setSubmittingVote(false)
    }
  }

  return (
    <ScreenChrome title="Poll">
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!communityId || !pollId ? (
        <View style={styles.listCard}>
          <Text style={styles.muted}>Poll not available.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading poll…</Text>
        </View>
      ) : poll ? (
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>{poll.title}</Text>
            {poll.description ? <Text style={styles.cardSubtle}>{poll.description}</Text> : null}
            <Text style={styles.cardSubtle}>Status: {poll.status}</Text>
            <Text style={styles.cardSubtle}>
              {formatDate(poll.startAt)} → {formatDate(poll.endAt)}
            </Text>
            {poll.userVoted && submittedOptions.length ? (
              <View style={styles.voteSummary}>
                <Text style={styles.voteSummaryLabel}>Your vote</Text>
                <Text style={styles.voteSummaryText}>
                  {poll.options
                    ?.filter((opt: any) => submittedOptions.includes(opt.id))
                    .map((opt: any) => opt.text)
                    .join(', ') || '—'}
                </Text>
              </View>
            ) : null}
            {!canVote ? <Text style={styles.muted}>Voting is closed.</Text> : null}
          </View>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Options</Text>
            {poll.options?.length ? (
              poll.options.map((opt: any) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.optionRow, selectedOptions.includes(opt.id) && styles.optionRowSelected]}
                  onPress={() => {
                    if (canVote) toggleOption(opt.id)
                  }}
                  disabled={!canVote}
                >
                  <View style={styles.optionRowHeader}>
                    <Text style={styles.optionRowText}>{opt.text}</Text>
                    {poll.userVoted && submittedOptions.includes(opt.id) ? (
                      <Text style={styles.optionRowBadge}>Your vote</Text>
                    ) : null}
                  </View>
                  {typeof opt.votes === 'number' ? <Text style={styles.cardRowMeta}>{opt.votes} votes</Text> : null}
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.muted}>No options.</Text>
            )}
            {voteStatus ? <Text style={styles.muted}>{voteStatus}</Text> : null}
            {canVote ? (
              <View style={styles.voteActions}>
                <TouchableOpacity
                  style={[styles.button, (!selectedOptions.length || submittingVote) && styles.buttonDisabled]}
                  onPress={submitVote}
                  disabled={!selectedOptions.length || submittingVote}
                >
                  <Text style={styles.buttonText}>{submittingVote ? 'Submitting…' : 'Submit vote'}</Text>
                </TouchableOpacity>
                {poll?.userVoted ? (
                  <TouchableOpacity
                    style={[styles.button, styles.buttonGhost, submittingVote && styles.buttonDisabled]}
                    onPress={removeVote}
                    disabled={submittingVote}
                  >
                    <Text style={styles.buttonGhostText}>{submittingVote ? 'Working…' : 'Remove vote'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.listCard}>
          <Text style={styles.muted}>No poll data.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}

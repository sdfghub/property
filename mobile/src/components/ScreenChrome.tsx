import React from 'react'
import { Modal, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import { useBeScope } from '../contexts/BeScopeContext'
import { getBeLabel } from '../utils/formatters'
import { styles } from '../styles/appStyles'

type ScreenChromeProps = {
  title: string
  activeSection?: string
  breadcrumb?: string | null
  onScopeChange?: (id: string | null) => void
  onNavigateSection?: (section: string) => void
  children: React.ReactNode
}

export function ScreenChrome({
  title,
  activeSection,
  breadcrumb,
  onScopeChange,
  onNavigateSection,
  children,
}: ScreenChromeProps) {
  const { activeRole, roles, logout } = useAuth()
  const beScope = useBeScope()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const currentRoute = route?.name || title
  const currentSection = activeSection || currentRoute
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [bePickerOpen, setBePickerOpen] = React.useState(false)
  const canGoBack = typeof navigation.canGoBack === 'function' ? navigation.canGoBack() : false

  const beRole =
    (activeRole?.scopeType === 'BILLING_ENTITY' ? activeRole : null) || roles.find((role) => role.scopeType === 'BILLING_ENTITY') || null
  const beRoles = roles.filter((role) => role.scopeType === 'BILLING_ENTITY' && role.scopeId)
  const beId = beScope.selectedBeId || beRole?.scopeId || ''

  React.useEffect(() => {
    if (beScope.shouldPrompt) {
      setBePickerOpen(true)
      beScope.markPrompted()
    }
  }, [beScope])

  const resolvedBreadcrumb = breadcrumb ?? null

  return (
    <View style={styles.screen}>
      {beRoles.length > 1 ? (
        <TouchableOpacity onPress={() => setBePickerOpen(true)} style={styles.scopeSelector}>
          <Text style={styles.scopeSelectorValue}>{getBeLabel(beId, beScope.beMetaMap, beScope.communityMap) || beId}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.menuButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        {resolvedBreadcrumb ? <Text style={styles.headerBreadcrumb}>{resolvedBreadcrumb}</Text> : <View style={styles.headerBreadcrumbSpacer} />}
        <View style={styles.headerActions}>
          {canGoBack ? (
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Text style={styles.backButtonIcon}>←</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Main', { section: 'My Dashboard' })}>
            <Text style={styles.homeButtonIcon}>⌂</Text>
          </TouchableOpacity>
        </View>
      </View>
      {children}

      <Modal animationType="slide" transparent visible={menuOpen} onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View />
        </TouchableOpacity>
        <View style={styles.menuPanel}>
          <Text style={styles.menuTitle}>Mă ocup eu</Text>
          {['Dashboard', 'Community Dashboard', 'My Dashboard', 'Notifications', 'Communications', 'Expenses', 'Programs', 'Events', 'Polls'].map((item) => {
            const isActive = currentSection === item
            return (
              <TouchableOpacity
                key={item}
                style={[styles.menuItem, isActive && styles.menuItemActive]}
                onPress={() => {
                  setMenuOpen(false)
                  if (isActive) return
                  if (onNavigateSection) {
                    onNavigateSection(item)
                    return
                  }
                  navigation.navigate('Main', { section: item })
                }}
              >
                <Text style={[styles.menuItemText, isActive && styles.menuItemTextActive]}>{item}</Text>
              </TouchableOpacity>
            )
          })}
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemDanger]}
            onPress={() => {
              setMenuOpen(false)
              logout()
            }}
          >
            <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={bePickerOpen} onRequestClose={() => setBePickerOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} onPress={() => setBePickerOpen(false)}>
          <View />
        </TouchableOpacity>
        <View style={styles.menuPanel}>
          <Text style={styles.menuTitle}>Select billing entity</Text>
          {beRoles.map((role) => (
            <TouchableOpacity
              key={role.scopeId}
              style={[styles.menuItem, role.scopeId === beId && styles.menuItemActive]}
              onPress={() => {
                beScope.setSelectedBeId(role.scopeId || null)
                onScopeChange?.(role.scopeId || null)
                setBePickerOpen(false)
              }}
            >
              <Text style={[styles.menuItemText, role.scopeId === beId && styles.menuItemTextActive]}>
                {getBeLabel(role.scopeId || '', beScope.beMetaMap, beScope.communityMap) || role.scopeId}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </View>
  )
}

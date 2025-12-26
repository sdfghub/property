import { decode as atob } from 'base-64'
import { registerRootComponent } from 'expo'

import App from './App'

if (typeof globalThis.atob !== 'function') {
  ;(globalThis as any).atob = atob
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App)

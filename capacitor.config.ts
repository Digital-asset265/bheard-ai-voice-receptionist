import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bheard.app',
  appName: 'BHeard',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
}

export default config

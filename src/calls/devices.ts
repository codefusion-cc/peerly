import { createDeviceSelection } from '@codefusion-cc/realtime-media/browser'
import { APP_ID } from '../config.ts'

/** The microphone, camera and speaker this device chose for calls, kept per browser. */
export const devices = createDeviceSelection(APP_ID)

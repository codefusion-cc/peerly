/**
 * Every string the page shows, in English and Polish. A component never holds
 * copy of its own: it reads `t.key` (or calls `t.key(…)` for one with values).
 * Both languages carry every key, so switching is a data change.
 */
export type Locale = 'en' | 'pl'

const STORAGE_KEY = 'peerly-locale'

/** The person's language: what they picked on this device, else the browser's. */
export function detectLocale(stored: string | null = readStored(), languages: readonly string[] = navigator.languages ?? [navigator.language]): Locale {
  if (stored === 'en' || stored === 'pl') return stored
  return languages.some(language => language?.toLowerCase().startsWith('pl')) ? 'pl' : 'en'
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Kept for this page only.
  }
}

const en = {
  appName: 'Peerly',
  tagline: 'Team chat, files and calls that go straight between you.',
  loading: 'Loading…',
  retry: 'Try again',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  saving: 'Saving…',
  done: 'Done',
  back: 'Back',
  copy: 'Copy',
  copied: 'Copied',
  remove: 'Remove',
  more: 'More',
  skipToContent: 'Skip to content',
  email: 'Email',

  // Sign-in
  signInTitle: 'Sign in to Peerly',
  signInBody: 'Use the account your team invited. Peerly checks the address with your provider and never sees your password.',
  signInWith: (provider: string) => `Continue with ${provider}`,
  signInProviders: 'Sign-in options',
  signInNoProviders: 'This Peerly has no sign-in set up yet. Ask whoever runs it.',
  signInProvidersFailed: 'We could not reach Peerly to load the sign-in options.',
  signInFailed: 'Sign-in did not work. Please try again.',
  signInExpired: 'That sign-in took too long. Please start it again.',
  signInNeedsStorage: 'Your browser blocks the storage Peerly needs to sign in. Allow it for this site and try again.',
  signingIn: 'Signing you in…',
  signInRejected: 'Your provider did not confirm this address, or the sign-in was refused.',
  signInUnavailable: 'Sign-in is unavailable right now. We will try again in a moment.',
  /** Parts around the two links (each passed in as a rendered link). */
  signInLegal: <T>(terms: T, privacy: T) => ['By signing in you accept the ', terms, ' and the ', privacy, '.'],
  signInSuspended: 'This account cannot use Peerly at the moment. Contact whoever runs it.',
  terms: 'Terms',
  privacy: 'Privacy Policy',
  signOut: 'Sign out',
  signedInAs: (email: string) => `Signed in as ${email}`,
  heroPoints: [
    'Messages and files go peer to peer, encrypted end to end.',
    'Only the people your workspace lists can get in.',
    'Premium keeps history and files in the cloud, and connects calls through any network.',
  ],

  // Shell
  workspaces: 'Workspaces',
  account: 'Account',
  settings: 'Settings',
  theme: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  language: 'Language',
  version: (version: string, commit: string) => `Version ${version} (${commit})`,
  offline: 'You are offline. Messages wait until you are back.',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  updateReady: 'A new version of Peerly is ready.',
  updateReload: 'Reload',
}

export type Strings = typeof en

const pl: Strings = {
  appName: 'Peerly',
  tagline: 'Czat, pliki i rozmowy zespołu, które idą prosto między wami.',
  loading: 'Wczytywanie…',
  retry: 'Spróbuj ponownie',
  cancel: 'Anuluj',
  close: 'Zamknij',
  save: 'Zapisz',
  saving: 'Zapisywanie…',
  done: 'Gotowe',
  back: 'Wstecz',
  copy: 'Kopiuj',
  copied: 'Skopiowano',
  remove: 'Usuń',
  more: 'Więcej',
  skipToContent: 'Przejdź do treści',
  email: 'E-mail',

  signInTitle: 'Zaloguj się do Peerly',
  signInBody: 'Użyj konta, na które zaprosił cię zespół. Peerly sprawdza adres u twojego dostawcy i nigdy nie widzi hasła.',
  signInWith: (provider: string) => `Kontynuuj przez ${provider}`,
  signInProviders: 'Sposoby logowania',
  signInNoProviders: 'To Peerly nie ma jeszcze ustawionego logowania. Zapytaj osobę, która je prowadzi.',
  signInProvidersFailed: 'Nie udało się połączyć z Peerly, żeby wczytać sposoby logowania.',
  signInFailed: 'Logowanie się nie udało. Spróbuj ponownie.',
  signInExpired: 'Logowanie trwało zbyt długo. Zacznij je od nowa.',
  signInNeedsStorage: 'Przeglądarka blokuje pamięć, której Peerly potrzebuje do logowania. Zezwól na nią dla tej strony i spróbuj ponownie.',
  signingIn: 'Logowanie…',
  signInRejected: 'Twój dostawca nie potwierdził tego adresu albo logowanie zostało odrzucone.',
  signInUnavailable: 'Logowanie jest chwilowo niedostępne. Za chwilę spróbujemy ponownie.',
  signInLegal: <T>(terms: T, privacy: T) => ['Logując się, akceptujesz ', terms, ' i ', privacy, '.'],
  signInSuspended: 'To konto nie może teraz korzystać z Peerly. Skontaktuj się z osobą, która je prowadzi.',
  terms: 'Regulamin',
  privacy: 'Politykę prywatności',
  signOut: 'Wyloguj się',
  signedInAs: (email: string) => `Zalogowano jako ${email}`,
  heroPoints: [
    'Wiadomości i pliki idą peer to peer, szyfrowane od końca do końca.',
    'Do przestrzeni wejdą tylko osoby z jej listy.',
    'Premium przechowuje historię i pliki w chmurze i łączy rozmowy przez każdą sieć.',
  ],

  workspaces: 'Przestrzenie',
  account: 'Konto',
  settings: 'Ustawienia',
  theme: 'Motyw',
  themeLight: 'Jasny',
  themeDark: 'Ciemny',
  themeSystem: 'Systemowy',
  language: 'Język',
  version: (version: string, commit: string) => `Wersja ${version} (${commit})`,
  offline: 'Jesteś offline. Wiadomości poczekają, aż wrócisz.',
  connecting: 'Łączenie…',
  reconnecting: 'Ponowne łączenie…',
  connected: 'Połączono',
  updateReady: 'Nowa wersja Peerly jest gotowa.',
  updateReload: 'Odśwież',
}

export const STRINGS: Record<Locale, Strings> = { en, pl }

import { avatarInitial } from '@codefusion-cc/realtime/browser'

/** Theme colours an avatar can take: each person keeps one, in light and dark alike. */
const TONES = [
  'bg-primary text-primary-content', 'bg-secondary text-secondary-content', 'bg-accent text-accent-content',
  'bg-info text-info-content', 'bg-success text-success-content', 'bg-warning text-warning-content',
  'bg-error text-error-content', 'bg-neutral text-neutral-content',
] as const

function toneOf(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return TONES[Math.abs(hash) % TONES.length]
}

const SIZES = { xs: 'size-6 text-2xs', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-base' } as const

/** A person's or a workspace's initials on its colour. Decorative: its name is always written beside it. */
export function Avatar({ name, seed, size = 'md', square = false, online }: {
  name: string; seed: string; size?: keyof typeof SIZES; square?: boolean; online?: boolean
}) {
  return (
    <span className={`relative inline-grid shrink-0 place-items-center font-semibold ${SIZES[size]} ${square ? 'rounded-xl' : 'rounded-full'} ${toneOf(seed)}`} aria-hidden="true">
      {avatarInitial(name) || '?'}
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-base-100 ${online ? 'bg-success' : 'bg-base-300'}`} />
      )}
    </span>
  )
}

/**
 * What the signal scope needs from the outside world, as ports so its rules
 * run in tests without workerd.
 */

export interface Clock {
  nowMs(): number
}

export interface Random {
  uuid(): string
}

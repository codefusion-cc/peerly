// For TypeScript tests that drive the real Worker (src/auth/googleRedirect.test.ts).
declare const worker: {
  fetch(request: Request, env: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>
}
export default worker
export function allowedAuthParent(origin: string): boolean

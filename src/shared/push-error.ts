/**
 * git refused a push because the remote has commits we lack, or our history was rewritten.
 * Not a hook or permission refusal (`[remote rejected]`) and not a lost lease (`stale info`),
 * which a force push would not fix.
 */
export const isPushRejected = (message: string): boolean =>
  /\[rejected\]/.test(message) && /(non-fast-forward|fetch first|tip of your current branch is behind)/.test(message)

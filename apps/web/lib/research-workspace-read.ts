/** Issuing a newer read must not starve an earlier completed read. Only a
 * changed request scope or an already-applied newer result makes it obsolete. */
export function researchReadIsCurrent(originScope: string, currentScope: string, sequence: number, lastAppliedSequence: number) {
  return originScope === currentScope && sequence > lastAppliedSequence;
}

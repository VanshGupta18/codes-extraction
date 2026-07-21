/** Display label for ranked HSN candidates (0 = top match, 1+ = alternatives). */
export function candidateRankLabel(index) {
  return index === 0 ? 'Top' : 'Alternative';
}

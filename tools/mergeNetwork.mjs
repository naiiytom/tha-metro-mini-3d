/**
 * Merge a partial (`data:fetch -- <key>...`) fetch into the existing
 * network.json, so fetching one line never destroys the others.
 *
 * Output order follows the registry (the registry-index invariant). A registry
 * line that was neither fetched nor present in the existing file is an error,
 * not a silent drop — dropping it would shift every later line's index.
 *
 * @param {string[]} registryKeys  LINES keys, in registry order
 * @param {object[]} fetched       freshly fetched line records
 * @param {{lines?: object[], handPatches?: object[]}} existing  current network.json
 * @returns {{lines: object[], handPatches: object[]}}
 */
export function mergeFetchedLines(registryKeys, fetched, existing) {
  const fetchedMap = new Map(fetched.map((l) => [l.key, l]));
  const existingMap = new Map((existing.lines ?? []).map((l) => [l.key, l]));
  const missing = registryKeys.filter((k) => !fetchedMap.has(k) && !existingMap.has(k));
  if (missing.length > 0) {
    throw new Error(
      `registry line(s) ${missing.join(", ")} are in neither this fetch nor the existing ` +
        `network.json; fetch them too (or run a full fetch) so line order stays intact`,
    );
  }
  return {
    lines: registryKeys.map((k) => fetchedMap.get(k) ?? existingMap.get(k)),
    // A re-fetched line's hand patches are superseded by the fetch.
    handPatches: (existing.handPatches ?? []).filter((hp) => !fetchedMap.has(hp.line)),
  };
}

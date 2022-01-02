import { SelectionGedcom, SelectionIndividualRecord } from 'read-gedcom';
import { parentChildrenFiliation } from './filiation';

const PERMANENT_MARK = true, TEMPORARY_MARK = false;

export interface CycleDetectionOptions {
  /**
   * Filiation function that returns a selection of adjacent records.
   * @param individual The node of interest; it is guaranteed that this selection contains exactly one element
   */
  adjacency?: (individual: SelectionIndividualRecord) => SelectionIndividualRecord;
}

/**
 * Checks whether this graph contains a cycle, with respect to the filiation relation (or {@link CycleDetectionOptions.adjacency} if defined).
 * @param gedcom The gedcom root selection
 * @param options Additional options
 */
export const containsCycle = (gedcom: SelectionGedcom, options: CycleDetectionOptions = {}): boolean => {
  // TODO don't rely on exceptions
  try {
    topologicalSort(gedcom, options);
  } catch (e) {
    return true;
  }
  return false;
};

const topologicalSort = (gedcom: SelectionGedcom, options: CycleDetectionOptions = {}): string[] => {
  // TODO make iterative

  const adjacency = options.adjacency || parentChildrenFiliation;

  const sorted: string[] = []; // <-- A sorted array of individuals (children first, parents after)
  const marks: { [id: string]: (typeof PERMANENT_MARK) | (typeof TEMPORARY_MARK) } = {};
  const nonPermanentlyMarked = new Set();

  gedcom.getIndividualRecord().arraySelect().forEach(individual => nonPermanentlyMarked.add(individual.pointer()[0]));

  const visit = (individual: SelectionIndividualRecord) => {
    const id = individual.pointer()[0] as string;
    const mark = marks[id];
    if (mark === PERMANENT_MARK) {
      return;
    } else if (mark === TEMPORARY_MARK) {
      throw new Error('The Gedcom file contains a cycle!');
    }
    nonPermanentlyMarked.add(id);
    marks[id] = TEMPORARY_MARK;
    adjacency(individual).arraySelect().forEach(child => visit(child));
    nonPermanentlyMarked.delete(id);
    marks[id] = PERMANENT_MARK;
    sorted.push(id); // <-- Build the sorted array
  };

  while (nonPermanentlyMarked.size > 0) {
    const firstId = nonPermanentlyMarked.values().next().value;
    const individual = gedcom.getIndividualRecord(firstId);
    visit(individual);
  }

  return sorted;
};

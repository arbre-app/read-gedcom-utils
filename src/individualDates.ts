import {
  SelectionGedcom,
  SelectionIndividualEvent,
  SelectionIndividualReference,
  Tag,
  toJsDate,
  ValueDate, ValueDatePeriodFull,
  ValueDateRangeFull,
  ValuePartDate,
  ValuePartDateDay,
  ValuePartDateMonth,
  ValueSex,
} from 'read-gedcom';

export interface FiliationParameters {
  maxAgeMale?: number,
  maxAgeFemale?: number,
  minFatherAge?: number,
  maxFatherAge?: number,
  minMotherAge?: number,
  maxMotherAge?: number,
  maxPregnancyDuration?: number,
  datePlusMinus?: number,
  maxYear?: number | null,
}

// These values are derived from real data (yes)
export const defaultFiliationParameters = {
  maxAgeMale: 117,
  maxAgeFemale: 123,
  minFatherAge: 12,
  maxFatherAge: 100,
  minMotherAge: 5,
  maxMotherAge: 75,
  maxPregnancyDuration: 2,
  datePlusMinus: 5,
  maxYear: null as number | null,
};

export type DateInterval = [Date | null, Date | null];

export interface EstimatedDate {
  birth: DateInterval;
  death: DateInterval;
  inconsistent: boolean;
}

export interface EstimatedDates {
  [id: string]: EstimatedDate;
}

export const estimateIndividualsDates = (gedcom: SelectionGedcom, parameters: FiliationParameters): EstimatedDates => {
  const actualParameters: typeof defaultFiliationParameters = { ...defaultFiliationParameters, ...parameters };
  const maxYear = actualParameters.maxYear ?? new Date().getFullYear();
  const maxDate = new Date(Date.UTC(maxYear, 12 - 1, 31));

  const individualIds = gedcom.getIndividualRecord().array().map(node => node.pointer as string);

  const withAddedYears = (date: Date, years: number): Date => {
    const newDate = new Date(date.getTime());
    newDate.setUTCFullYear(newDate.getFullYear() + years);
    return newDate;
  };
  const compareDates = (date1: Date, date2: Date): number => {
    if (date1.getFullYear() < date2.getFullYear()) {
      return -1;
    } else if (date1.getFullYear() > date2.getFullYear()) {
      return 1;
    } else {
      if (date1.getMonth() < date2.getMonth()) {
        return -1;
      } else if (date1.getMonth() > date2.getMonth()) {
        return 1;
      } else {
        if (date1.getDate() < date2.getDate()) {
          return -1;
        } else if (date1.getDate() > date2.getDate()) {
          return 1;
        } else {
          return 0;
        }
      }
    }
  };

  const intervals = Object.fromEntries(individualIds.map(id => {
    const individual = gedcom.getIndividualRecord(id);
    const getDatesForTags = (tags: Tag[]) => individual.get(tags).as(SelectionIndividualEvent).getDate().valueAsDate().filter(d => d !== null)[0];
    const birthDate = getDatesForTags([Tag.Birth, Tag.Baptism]), deathDate = getDatesForTags([Tag.Death, Tag.Cremation, Tag.Burial]);
    const toJsDateUpperBound = <D extends Date | null>(date: ValuePartDate, jsDate: D): D => {
      if (jsDate !== null) { // This is the hard case
        if ((date as ValuePartDateDay).day != null) {
          // Nothing to do
        } else if ((date as ValuePartDateMonth).month != null) {
          jsDate.setUTCDate(1);
          jsDate.setUTCMonth(jsDate.getMonth() + 1);
          jsDate.setUTCDate(-1); // Remove one day
          // FIXME this won't work correctly for other calendars!
        } else {
          jsDate.setUTCDate(1);
          jsDate.setUTCMonth(0); // (0 for January)
          jsDate.setUTCFullYear(jsDate.getFullYear() + 1);
          jsDate.setUTCDate(-1); // Remove one day
          // FIXME similar problem
        }
      }
      return jsDate;
    };
    const dateToInterval = (date: ValueDate | null): [Date | null, Date | null] => {
      if (!date || !date.hasDate) {
        return [null, null];
      }

      let after = null, before = null;

      if (date.isDatePunctual) {
        const dt = toJsDate(date.date); // Possibly null
        if (date.isDateApproximated) {
          if (dt !== null) {
            after = withAddedYears(dt, -actualParameters.datePlusMinus);
            before = withAddedYears(toJsDateUpperBound(date.date, new Date(dt.getTime())), actualParameters.datePlusMinus);
          }
        } else { // Interpreted (text) or normal
          if (dt !== null) {
            after = dt;
            before = toJsDateUpperBound(date.date, new Date(dt.getTime())); // Clone to avoid issues further on
          }
        }
      } else if (date.isDateRange) {
        const dateRange = date as ValueDateRangeFull;
        if (dateRange.dateAfter != null) {
          after = toJsDate(dateRange.dateAfter);
        }
        if (dateRange.dateBefore != null) {
          before = toJsDateUpperBound(dateRange.dateBefore, toJsDate(dateRange.dateBefore));
        }
      } else if (date.isDatePeriod) { // We choose to also interpret date periods
        const datePeriod = date as ValueDatePeriodFull;
        if (datePeriod.dateFrom != null) {
          after = toJsDate(datePeriod.dateFrom);
        }
        if (datePeriod.dateTo != null) {
          before = toJsDateUpperBound(datePeriod.dateTo, toJsDate(datePeriod.dateTo));
        }
      } // This should be the last case

      return [after, before];
    };
    const birthDateInterval = dateToInterval(birthDate), deathDateInterval = dateToInterval(deathDate);

    return [id, { birth: birthDateInterval, death: deathDateInterval }];
  }));

  const EVENT_BIRTH = 'birth', EVENT_DEATH = 'death'; // TODO replace by booleans
  const BOUND_AFTER = 'after', BOUND_BEFORE = 'before';

  type EventKey = typeof EVENT_BIRTH | typeof EVENT_DEATH;
  type BoundKey = typeof BOUND_AFTER | typeof BOUND_BEFORE;
  type VariableKey = { id: string, event: EventKey, bound: BoundKey };
  type Constraint = { x: VariableKey, y: VariableKey, c: number };

  // Constraints are all of the form: { x, y, c }
  // Representing the mathematical inequality: x - y <= c
  // With x, y identifiers of the form: { id, event, bound }
  // And c a constant number (equal to 0 most of the time)
  const constraints: Constraint[] = individualIds.flatMap(id => {
    const individual = gedcom.getIndividualRecord(id);
    const gender = individual.getSex().value()[0];
    // [{ id, gender }]
    const parents = individual.getFamilyAsChild().get([Tag.Husband, Tag.Wife]).as(SelectionIndividualReference).getIndividualRecord().arraySelect().map(record => ({
      parentId: record.pointer()[0],
      gender: record.getSex().value()[0],
    }));

    // An event must be an interval
    const eventIsIntervalConstraints: Constraint[] = ([EVENT_BIRTH, EVENT_DEATH] as EventKey[]).map(event => (
      { x: { id, event, bound: BOUND_AFTER }, y: { id, event, bound: BOUND_BEFORE }, c: 0 }
    ));
    // Birth must occur before death
    const birthBeforeDeathConstraints: Constraint[] = ([BOUND_BEFORE, BOUND_AFTER] as BoundKey[]).map(bound => (
      { x: { id, event: EVENT_BIRTH, bound }, y: { id, event: EVENT_DEATH, bound }, c: 0 }
    ));
    // An individual cannot live older than a certain age
    const maximumAgeConstraints: Constraint[] = ([BOUND_BEFORE, BOUND_AFTER] as BoundKey[]).map(bound => (
      {
        x: { id, event: EVENT_DEATH, bound },
        y: { id, event: EVENT_BIRTH, bound },
        c: gender === ValueSex.Male ? actualParameters.maxAgeMale : gender === ValueSex.Female ? actualParameters.maxAgeFemale : Math.max(actualParameters.maxAgeMale, actualParameters.maxAgeFemale),
      }
    ));
    // Child/parents relations
    const childParentsConstraints: Constraint[] = parents.flatMap(({ parentId, gender }) => {
      const valueFor = (fatherValue: number, motherValue: number) => {
        return gender === ValueSex.Male
          ? fatherValue
          : gender === ValueSex.Female
            ? motherValue
            : Math.max(fatherValue, motherValue); // We take the maximum between the two, that way we are guaranteed to satisfy both branches: a <= max(a, b) and b <= max(a, b)
      };
      return ([BOUND_BEFORE, BOUND_AFTER] as BoundKey[]).flatMap(bound => [
        // An individual cannot be a father until a certain age
        { x: { id: parentId, event: EVENT_BIRTH, bound }, y: { id, event: EVENT_BIRTH, bound }, c: valueFor(-actualParameters.minFatherAge, -actualParameters.minMotherAge) },
        // An individual cannot be a father of new children after a certain age
        { x: { id, event: EVENT_BIRTH, bound }, y: { id: parentId, event: EVENT_BIRTH, bound }, c: valueFor(actualParameters.maxFatherAge, actualParameters.maxMotherAge) },
        // A man can die before they become a father of a child, a woman can't
        { x: { id, event: EVENT_BIRTH, bound }, y: { id: parentId, event: EVENT_DEATH, bound }, c: valueFor(actualParameters.maxPregnancyDuration, 0) }, // These arguments are in the correct order
      ]);
    });

    // Note that there is an additional constraint in the form `x <= maxYear` that is handled separately (below)
    return [
      eventIsIntervalConstraints,
      birthBeforeDeathConstraints,
      maximumAgeConstraints,
      childParentsConstraints,
    ].flat();
  });

  // The algorithm implemented below roughly works as follows:
  // - Initially all variables are marked as active (active means present in the `queue`)
  // - Then, while the queue is nonempty:
  //   * Pop the first variable
  //   * List all constraints `x - y <= c` it is involved in
  //   * For each of those constraints for which both variables are not marked as `inconsistent`, and the inequality is not verified:
  //     - `BOUND_AFTER` variables are only allowed to increase their assignment's value, while `BOUND_BEFORE` can only decrease them
  //     - Find a new assignment that respects the above invariant and such that the inequality is verified again
  //     - Add the updated variable to the queue
  //     - If no such assignment is found, then mark both variables as inconsistent
  // The constraints of the form `x <= c` are handled separately
  // The loop should eventually halt (but this has not yet been proven, so we use a safeguard instead)

  const metaData = Object.fromEntries(individualIds.map(id => {
    const generateEvent = ([after, before]: [Date | null, Date | null]) => {
      const generateMetadata = (value: Date | null) => ({ assignment: value, index: [] as Constraint[], marked: true, inconsistent: false });
      return { after: generateMetadata(after), before: generateMetadata(before) };
    };
    const interval = intervals[id];
    return [id, { birth: generateEvent(interval.birth), death: generateEvent(interval.death) }];
  }));

  const getMetaData = ({ id, event, bound }: VariableKey) => {
    const interval = metaData[id];
    const withEvent = event === EVENT_BIRTH ? interval.birth : interval.death;
    return bound === BOUND_AFTER ? withEvent.after : withEvent.before;
  };

  const queue: VariableKey[] = individualIds.flatMap(id =>
    ([EVENT_BIRTH, EVENT_DEATH] as EventKey[]).flatMap(event =>
      ([BOUND_AFTER, BOUND_BEFORE] as BoundKey[]).map(bound =>
        ({ id, event, bound }))));

  const isSameIds = ({ id: id1, event: event1, bound: bound1 }: VariableKey, { id: id2, event: event2, bound: bound2 }: VariableKey): boolean =>
    id1 === id2 && event1 === event2 && bound1 === bound2;

  constraints.forEach(constraint => {
    const { x, y } = constraint;
    [x, y].forEach(idVector => {
      const { index } = getMetaData(idVector);
      index.push(constraint);
    });
  });

  let inconsistent = false;

  const markInconsistency = (variable: VariableKey): void => {
    inconsistent = true;
    getMetaData(variable).inconsistent = true;
    let bfs = [variable];
    while (bfs.length > 0) {
      const next: VariableKey[] = [];
      bfs.forEach(variable => {
        const meta = getMetaData(variable);
        // Restore original data
        const intervalData = intervals[variable.id];
        const interval = variable.event === EVENT_BIRTH ? intervalData.birth : intervalData.death;
        meta.assignment = interval[variable.bound === BOUND_AFTER ? 0 : 1];

        meta.index.forEach(({ x, y }) => {
          [x, y].forEach(neighbour => {
            const neighbourMeta = getMetaData(neighbour);
            if (!neighbourMeta.inconsistent) {
              neighbourMeta.inconsistent = true;
              next.push(neighbour);
            }
          });
        });
      });
      bfs = next;
    }
  };

  let i = 0;
  const maxIterations = 1000000; // TODO
  while (queue.length > 0 && i < maxIterations) {
    const variable = queue.pop() as VariableKey; // Queue is nonempty

    const variableMetaData = getMetaData(variable);
    variableMetaData.marked = false;

    if (variableMetaData.inconsistent) {
      continue;
    }

    // That person is known to have been alive, so their birth cannot occur in the future
    if (variable.event === EVENT_BIRTH) {
      if (variable.bound === BOUND_AFTER && variableMetaData.assignment !== null && compareDates(variableMetaData.assignment, maxDate) > 0) {
        markInconsistency(variable);
      } else if (variable.bound === BOUND_BEFORE && (variableMetaData.assignment === null || compareDates(variableMetaData.assignment, maxDate) > 0)) {
        variableMetaData.assignment = maxDate;
        // Invariant: `!marked`
        variableMetaData.marked = true;
        queue.push(variable);
      }
    }

    variableMetaData.index.forEach(({ x, y, c }) => { // x - y <= c
      const metaX = getMetaData(x), metaY = getMetaData(y);
      if (!metaX.inconsistent && !metaY.inconsistent) {
        const isInequalityViolated = metaX.assignment !== null && metaY.assignment !== null && compareDates(metaX.assignment, withAddedYears(metaY.assignment, c)) > 0;
        let updated = null;
        if (isSameIds(x, y) && c < 0) { // Edge case: z - z <= c  <=>  c >= 0
          markInconsistency(x);
        } else if (x.bound === BOUND_AFTER && y.bound === BOUND_BEFORE) {
          if (metaX.assignment !== null && metaY.assignment !== null && isInequalityViolated) { // General inconsistency
            markInconsistency(x);
            //markInconsistency(y); // <- Not needed
          }
        } else if (x.bound === BOUND_AFTER && y.bound === BOUND_AFTER) {
          if (metaX.assignment !== null && (metaY.assignment === null || isInequalityViolated)) { // y := x - c
            metaY.assignment = withAddedYears(metaX.assignment, -c);
            updated = y;
          }
        } else if (x.bound === BOUND_BEFORE && y.bound === BOUND_BEFORE) {
          if (metaY.assignment !== null) {
            if (metaX.assignment === null || isInequalityViolated) { // x := y + c
              metaX.assignment = withAddedYears(metaY.assignment, c);
              updated = x;
            }
          }
        } else if (x.bound === BOUND_BEFORE && y.bound === BOUND_AFTER) { // Ambiguous case
          throw new Error('This type of constraint is not allowed');
          /*if (isInequalityViolated) { // x := y + c
            metaX.assignment = withAddedYears(metaY.assignment as Date, c); // (`isInequalityViolated` implies that both assignments are non-null)
            updated = x;
          }*/
        }

        if (updated !== null) {
          const meta = getMetaData(updated);
          if (!meta.marked) {
            queue.push(updated);
            meta.marked = true;
          }
        }
      }

      // Else, nothing to do
    });

    i++;
  }

  const hasFinishedGracefully = !queue.length && !inconsistent;

  if (!hasFinishedGracefully) {
    console.log(inconsistent ? 'Inconsistent' : 'Did not converge'); // TODO remove
  }

  const result: EstimatedDates = Object.fromEntries(individualIds.map(id => {
    const getEvent = (event: EventKey): [DateInterval, boolean] => {
      const metaAfter = getMetaData({ id, event, bound: BOUND_AFTER }), metaBefore = getMetaData({ id, event, bound: BOUND_BEFORE });
      return [[metaAfter.assignment, metaBefore.assignment], metaAfter.inconsistent || metaBefore.inconsistent];
    };
    const [birth, birthInconsistent] = getEvent(EVENT_BIRTH);
    const [death, deathInconsistent] = getEvent(EVENT_DEATH);
    return [id, { birth, death, inconsistent: birthInconsistent || deathInconsistent }];
  }));

  console.log(result); // TODO remove

  return result;
};

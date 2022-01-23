import { describe, it } from 'mocha';
import { expect } from 'chai';
import { readGedcom, ValueSex } from 'read-gedcom';
import { estimateIndividualsDates, FiliationParameters } from '../src';

describe('Individual dates estimations', () => {
  type Id = number;
  type IntervalBound = string | null;
  type Interval = [IntervalBound, IntervalBound];
  type Gender = ValueSex;

  const Male = ValueSex.Male, Female = ValueSex.Female;

  const filiationParameters: FiliationParameters = {
    maxAge: {
      male: 117,
      female: 123,
    },
    minParentAge: {
      male: 12,
      female: 5,
    },
    maxParentAge: {
      male: 100,
      female: 75,
    },
    maxPregnancyDuration: 2,
    datePlusMinus: 5,
    maxYear: 2000,
  };

  const checkFor = (
    individuals: { [id: Id]: { gender?: Gender, birth?: string, death?: string } },
    families: { husband: Id, wife: Id, children?: Id[] }[],
    expected: { [id: Id]: { birth?: Interval, death?: Interval, inconsistent?: boolean } },
  ) => {
    const individualIdFor = (id: number): string => `@I${id}@`, familyIdFor = (id: number): string => `@F${id}@`;

    const file = [
      '0 HEAD',
      ...Object.entries(individuals).flatMap(([id, { gender, birth, death }]) => [
        `0 ${individualIdFor(parseInt(id))} INDI`,
        ...(gender ? [`1 SEX ${gender}`] : []),
        ...(birth ? ['1 BIRT', `2 DATE ${birth}`] : []),
        ...(death ? ['1 DEAT', `2 DATE ${death}`] : []),
      ]),
      ...families.flatMap(({ husband, wife, children }, id) => [
        `0 ${familyIdFor(id)} FAM`,
        `1 HUSB ${individualIdFor(husband)}`,
        `1 WIFE ${individualIdFor(wife)}`,
        ...(children ?? []).map(child => `1 CHIL ${individualIdFor(child)}`),
      ]),
      '0 TRLR',
    ];
    const buffer = Buffer.from([...file, ''].join('\n'), 'utf-8');
    const gedcom = readGedcom(buffer);
    const result = estimateIndividualsDates(gedcom, filiationParameters);
    const formatDate = (date: string | null): Date | null => date ? new Date(date) : null;
    const formatInterval = (interval?: Interval) => interval ? interval.map(formatDate) : [null, null];
    const expectedFormatted = Object.fromEntries(Object.entries(expected).map(([id, { birth, death, inconsistent }]) => [individualIdFor(parseInt(id)), {
      birth: formatInterval(birth),
      death: formatInterval(death),
      inconsistent: !!inconsistent,
    }]));
    expect(result).to.deep.equal(expectedFormatted);
  };

  it('empty', () => {
    checkFor(
      { },
      [],
      { },
    );
  });

  it('single male individual', () => {
    checkFor(
      { 0: { gender: Male } },
      [],
      { 0: { birth: [null, '2000-12-31'], death: [null, '2117-12-31'] } },
    );
  });

  it('single female individual', () => {
    checkFor(
      { 0: { gender: Female } },
      [],
      { 0: { birth: [null, '2000-12-31'], death: [null, '2123-12-31'] } },
    );
  });

  it('single individual', () => {
    checkFor(
      { 0: { } },
      [],
      { 0: { birth: [null, '2000-12-31'], death: [null, '2123-12-31'] } },
    );
  });

  it('single individual birth in the future', () => {
    checkFor(
      { 0: { birth: '1 JAN 2010' } },
      [],
      { 0: { birth: ['2010-01-01', '2010-01-01'], death: [null, null], inconsistent: true } },
    );
  });

  it('small family', () => {
    checkFor(
      { 0: { gender: Male }, 1: { gender: Female }, 2: { gender: Male }, 3: { gender: Male, birth: '1 JAN 1990' } },
      [{ husband: 0, wife: 1, children: [2, 3] }],
      {
        0: { birth: ['1890-01-01', '1978-01-01'], death: ['1988-01-01', '2095-01-01'] },
        1: { birth: ['1915-01-01', '1985-01-01'], death: ['1990-01-01', '2108-01-01'] },
        2: { birth: ['1920-01-01', '2000-12-31'], death: ['1920-01-01', '2117-12-31'] },
        3: { birth: ['1990-01-01', '1990-01-01'], death: ['1990-01-01', '2107-01-01'] },
      },
    );
  });

  it('inconsistent self edge cycle', () => {
    checkFor(
      { 0: { gender: Male, birth: '1 JAN 1990' }, 1: { } },
      [
        { husband: 0, wife: 1, children: [0] },
      ],
      {
        0: { birth: ['1990-01-01', '1990-01-01'], inconsistent: true },
        1: { inconsistent: true },
      },
    );
  });

  it('inconsistent simple cycle', () => {
    checkFor(
      { 0: { gender: Male, birth: '1 JAN 1990' }, 1: { }, 2: { gender: Male }, 3: { } },
      [
        { husband: 0, wife: 1, children: [2] },
        { husband: 2, wife: 3, children: [0] },
      ],
      {
        0: { birth: ['1990-01-01', '1990-01-01'], inconsistent: true },
        1: { inconsistent: true },
        2: { inconsistent: true },
        3: { inconsistent: true },
      },
    );
  });

  /*it('inconsistent simple cycle 2', () => {
    checkFor(
      { 0: { gender: Male, death: 'BEF 1 JAN 1990' }, 1: { }, 2: { gender: Male }, 3: { } },
      [
        { husband: 0, wife: 1, children: [2] },
        { husband: 2, wife: 3, children: [0] },
      ],
      {
        0: { birth: ['1990-01-01', '1990-01-01'], inconsistent: true },
        1: { inconsistent: true },
        2: { inconsistent: true },
        3: { inconsistent: true },
      },
    );
  });*/

  it('high consanguinity', () => {
    checkFor(
      { 0: { gender: Male, birth: '1 JAN 1800' }, 1: { gender: Female }, 2: { gender: Male }, 3: { gender: Male }, 4: { gender: Male } },
      [
        { husband: 0, wife: 1, children: [2] },
        { husband: 2, wife: 1, children: [3] },
        { husband: 3, wife: 1, children: [4] },
      ],
      {
        0: { birth: ['1800-01-01', '1800-01-01'], death: ['1810-01-01', '1917-01-01'] },
        1: { birth: ['1761-01-01', '1895-01-01'], death: ['1836-01-01', '2018-01-01'] },
        2: { birth: ['1812-01-01', '1900-01-01'], death: ['1822-01-01', '2017-01-01'] },
        3: { birth: ['1824-01-01', '1958-01-01'], death: ['1834-01-01', '2075-01-01'] },
        4: { birth: ['1836-01-01', '1970-01-01'], death: ['1836-01-01', '2087-01-01'] },
      },
    );
  });
});

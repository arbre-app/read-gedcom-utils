import { SelectionFamilyRecord, SelectionIndividualRecord } from 'read-gedcom';

export const familyChildrenFiliation = (family: SelectionFamilyRecord): SelectionIndividualRecord => family.getChild().getIndividualRecord();

export const parentChildrenFiliation = (parent: SelectionIndividualRecord): SelectionIndividualRecord => familyChildrenFiliation(parent.getFamilyAsSpouse());

import {describe,it,expect} from 'vitest';
import {canonicalEnrollmentYears,enrollmentWindow,enrollmentParticipation,ENROLLMENT_POLICY_VERSION} from '../src/shared/enrollment';
describe('self-declared app academic-year policy',()=>{
 it('accepts only two bounded integer years, including same-year completion',()=>{
  expect(ENROLLMENT_POLICY_VERSION).toBe(1);
  for(const years of [{admissionYear:1900,graduationYear:1900},{admissionYear:2026,graduationYear:2026},{admissionYear:2026,graduationYear:2028},{admissionYear:2199,graduationYear:2199}])expect(canonicalEnrollmentYears(years)).toEqual(years);
  for(const value of [null,[],{},new Date(),{admissionYear:2026},{graduationYear:2027},{admissionYear:'2026',graduationYear:2027},{admissionYear:2026,graduationYear:'2027'},{admissionYear:2026.5,graduationYear:2027},{admissionYear:1899,graduationYear:2027},{admissionYear:2026,graduationYear:2200},{admissionYear:2027,graduationYear:2026},{admissionYear:NaN,graduationYear:2027},{admissionYear:2026,graduationYear:Infinity},{admissionYear:2026,graduationYear:2027,owner:'other'},{admissionYear:2026,graduationYear:2027,current:true},Object.assign(Object.create({}),{admissionYear:2026,graduationYear:2027})])expect(canonicalEnrollmentYears(value)).toBeNull();
 });
 it('uses inclusive JST Apr1 and exclusive Apr1 after graduation AY',()=>{
  const years={admissionYear:2026,graduationYear:2027},window=enrollmentWindow(years)!;
  expect(window).toEqual({startsAtMs:Date.parse('2026-03-31T15:00:00.000Z'),endsAtMs:Date.parse('2028-03-31T15:00:00.000Z')});
  const ownRecord={...years,version:1,updatedAtMs:1800000000000};expect(enrollmentWindow(ownRecord)).toEqual(window);
  expect(enrollmentParticipation(years,window.startsAtMs-1)).toBe('upcoming');
  expect(enrollmentParticipation(years,window.startsAtMs)).toBe('current');
  expect(enrollmentParticipation(years,window.endsAtMs-1)).toBe('current');
  expect(enrollmentParticipation(years,window.endsAtMs)).toBe('ended');
 });
 it('does not advance on Jan1 and handles leap days without fixed-year arithmetic',()=>{
  const years={admissionYear:2023,graduationYear:2023};
  for(const date of ['2023-12-31T23:59:59+09:00','2024-01-01T00:00:00+09:00','2024-02-29T12:00:00+09:00','2024-03-31T23:59:59.999+09:00'])expect(enrollmentParticipation(years,Date.parse(date))).toBe('current');
  expect(enrollmentParticipation(years,Date.parse('2024-04-01T00:00:00+09:00'))).toBe('ended');
  expect(enrollmentWindow(years)!.endsAtMs-enrollmentWindow(years)!.startsAtMs).toBe(366*86400000);
  expect(enrollmentWindow({admissionYear:2099,graduationYear:2099})!.endsAtMs-enrollmentWindow({admissionYear:2099,graduationYear:2099})!.startsAtMs).toBe(365*86400000);
 });
 it('classifies missing records and rejects invalid clocks instead of asserting current',()=>{
  expect(enrollmentParticipation(null,1800000000000)).toBe('missing');
  for(const now of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])expect(enrollmentParticipation({admissionYear:2026,graduationYear:2027},now)).toBeNull();
  expect(enrollmentWindow({admissionYear:2027,graduationYear:2026})).toBeNull();
 });
});

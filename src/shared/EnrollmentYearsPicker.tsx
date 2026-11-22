// Picks the two self-declared academic years as calendar months students already know
// ("2025年4月 入学" / "2027年3月 卒業予定") instead of asking them to compute 年度.
// Values stay academic years (graduationYear = the 年度 that ends in that March), so the
// server contract and stored data are unchanged.
import type { ReactNode } from 'react';
import './enrollment-picker.css';

const JST = 9 * 60 * 60 * 1000;
function currentAcademicYear(nowMs = Date.now()) {
  const d = new Date(nowMs + JST);
  return d.getUTCFullYear() - (d.getUTCMonth() < 3 ? 1 : 0);
}
const admissionLabel = (year: number) => `${year}年4月`;
const graduationLabel = (year: number) => `${year + 1}年3月`;
/** Default for a freshly chosen admission: a two-year course (most common here). */
const defaultGraduation = (admission: number) => admission + 1;

function range(from: number, to: number, keep: number[]) {
  const set = new Set<number>();
  for (let y = from; y <= to; y++) set.add(y);
  for (const y of keep) if (Number.isInteger(y) && y >= 1900 && y <= 2199) set.add(y);
  return [...set].sort((a, b) => a - b);
}

export default function EnrollmentYearsPicker({
  id,
  admission,
  graduation,
  onChange,
  disabled = false,
  nowMs,
  children,
}: {
  id: string;
  admission: string;
  graduation: string;
  onChange: (next: { admission: string; graduation: string }) => void;
  disabled?: boolean;
  nowMs?: number;
  children?: ReactNode;
}) {
  const now = currentAcademicYear(nowMs);
  const a = Number(admission),
    g = Number(graduation);
  const admissions = range(now - 8, now + 1, admission ? [a] : []);
  const base = admission ? a : now - 8;
  const graduations = range(base, base + 6, graduation && g >= base ? [g] : []);
  return (
    <div className="enrollment-picker">
      <div className="enrollment-picker-field">
        <label htmlFor={id + 'admission'}>入学</label>
        <select
          id={id + 'admission'}
          required
          disabled={disabled}
          value={admission}
          onChange={(event) => {
            const next = event.target.value;
            const n = Number(next);
            // Keep a still-valid graduation; otherwise suggest the common course length.
            onChange({
              admission: next,
              graduation:
                next && (!graduation || g < n) ? String(defaultGraduation(n)) : graduation,
            });
          }}
        >
          <option value="" disabled>
            選ぶ
          </option>
          {admissions.map((y) => (
            <option key={y} value={String(y)}>
              {admissionLabel(y)}
            </option>
          ))}
        </select>
      </div>
      <span className="enrollment-picker-arrow" aria-hidden="true">
        →
      </span>
      <div className="enrollment-picker-field">
        <label htmlFor={id + 'graduation'}>卒業予定</label>
        <select
          id={id + 'graduation'}
          required
          disabled={disabled || !admission}
          value={graduation}
          onChange={(event) => onChange({ admission, graduation: event.target.value })}
        >
          <option value="" disabled>
            選ぶ
          </option>
          {graduations.map((y) => (
            <option key={y} value={String(y)}>
              {graduationLabel(y)}
            </option>
          ))}
        </select>
      </div>
      {children}
    </div>
  );
}

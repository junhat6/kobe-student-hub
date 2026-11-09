import type { ProfileInput } from './profile-client';
export default function ProfileCard({
  value,
  preview = false,
}: {
  value: ProfileInput;
  preview?: boolean;
}) {
  return (
    <article
      className="profile-public-card"
      aria-label={preview ? '公開プロフィールのプレビュー' : '登録されたプロフィール'}
    >
      <span className="profile-public-avatar" aria-hidden="true">
        {'initials' in value
          ? String(value.initials)
          : Array.from(value.displayName.trim())[0] || '◎'}
      </span>
      <div>
        <h3>{value.displayName || '表示名がここに表示されます'}</h3>
        <p className="profile-public-meta">
          {[value.department, value.yearLabel].filter(Boolean).join(' · ') ||
            '学科・学年は未入力です'}
        </p>
        <p className="profile-public-bio">{value.bio || '自己紹介は未入力です'}</p>
      </div>
    </article>
  );
}

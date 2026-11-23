import type { OwnModerationNotice } from '../notification-types';

const label = {
  temporarily_hidden: '記事が一時非公開になりました',
  restored: '記事が復元されました',
  deleted: '記事が公開表示から削除されました',
  avatar_removed: 'プロフィールのアイコン画像が外されました',
};

/** One wording for a notice, shared by the header bell and the account page. */
export const noticeLabel = (item: Pick<OwnModerationNotice, 'id' | 'kind'>) =>
  /^project(?:-report)?\./.test(item.id)
    ? label[item.kind].replace('記事', '作品')
    : label[item.kind];

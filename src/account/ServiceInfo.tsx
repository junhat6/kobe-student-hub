import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createServiceInfoClient } from './service-info-client';
import { usePublicRead } from '../community/public-read';
import './service-info.css';

export default function ServiceInfo() {
  const client = useMemo(() => createServiceInfoClient(), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(signal), [client]);
  const { value, failed, retry } = usePublicRead('service-info', read);
  const { hash } = useLocation();
  useEffect(() => {
    if (!['#rules', '#privacy', '#contact'].includes(hash)) return;
    const heading = document.getElementById(hash.slice(1));
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <article className="shell about prose service-info">
      <h1>利用ルールと情報の扱い</h1>
      <p>学校の学びや制作を、記事・作品で共有する場所です。学校公式のサービスではありません。</p>
      <nav className="service-info-links" aria-label="この案内の内容">
        <a href="#rules">利用ルール</a>
        <a href="#privacy">情報の扱い</a>
        <a href="#contact">問い合わせ</a>
      </nav>
      <section>
        <h2 id="rules" tabIndex={-1}>
          共有するときのルール
        </h2>
        <ul>
          <li>
            自分の学び・制作・経験を、自分で確かめて投稿してください。AIを使った執筆もできます。
          </li>
          <li>他の人の個人情報や、許可なく使えない文章・画像は掲載しないでください。</li>
          <li>課題で考えたことや学びは共有できます。解答の丸写しは掲載しないでください。</li>
        </ul>
        <p>
          投稿には学校Googleでのログインが必要です。卒業予定年度を過ぎると、新規投稿はできません。
        </p>
      </section>
      <section>
        <h2 id="privacy" tabIndex={-1}>
          公開する情報・自分だけの情報
        </h2>
        <dl>
          <dt>読者に公開されるもの</dt>
          <dd>
            自分で確認した表示名・学科・学年・自己紹介、公開した記事・作品と画像、記事へのいいね一覧です。
          </dd>
          <dt>一般の読者に表示しないもの</dt>
          <dd>
            学校メール、Googleの認証識別子、入学年度・卒業予定年度、下書き、未公開の画像です。Googleの本名や写真を自動で公開することはありません。
          </dd>
        </dl>
        <p>
          Googleはログイン、Cloudflareは配信・保存に利用します。下書きの保存だけで本文や画像は公開されません。
        </p>
        <p>
          アプリ内の閲覧履歴は記録していません。YouTubeは「読み込む」を押してから外部に接続します。
        </p>
        <p>
          公開停止すると新しい閲覧から外れます。停止はデータ全体の消去や、すでに読者に届いた内容の回収ではありません。
        </p>
      </section>
      <section aria-labelledby="contact">
        <h2 id="contact" tabIndex={-1}>
          問い合わせ・異議申立て
        </h2>
        <p>
          運営判断への相談、削除や個人情報の修正についての案内です。卒業後など、学校Googleを使えなくなった場合も、この案内を確認してください。
        </p>
        {failed ? (
          <div role="alert">
            <p>問い合わせ先を確認できませんでした。</p>
            <Button className="primary" onClick={retry}>
              問い合わせ先を再読み込み
            </Button>
          </div>
        ) : !value ? (
          <p role="status">問い合わせ先を確認しています…</p>
        ) : value.contactUrl ? (
          <>
            <p>
              <a
                className="service-contact"
                href={value.contactUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {value.contactUrl.startsWith('mailto:')
                  ? 'メールで問い合わせる'
                  : '運営の問い合わせ窓口を開く'}
              </a>
            </p>
            <p>
              対象の記事・作品のURLと相談内容から始めてください。リンクを開くだけで本人確認や削除が完了するものではありません。パスワードや確認コードは送らないでください。
            </p>
          </>
        ) : (
          <p>
            問い合わせ窓口は現在未設定です。削除や運営判断への相談先は、決まり次第ここに表示します。
          </p>
        )}
      </section>
      <p className="service-info-back">
        <Link to="/about">このサイトについて</Link> · <Link to="/">記事・作品を読む</Link>
      </p>
    </article>
  );
}

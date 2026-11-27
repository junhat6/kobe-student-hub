import { authoringUiEnabled } from './routes';
import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createServiceInfoClient } from './service-info-client';
import { usePublicRead } from '../community/public-read';
import Icon from '../shared/Icon';
import './service-info.css';

export default function ServiceInfo() {
  const client = useMemo(() => createServiceInfoClient(), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(signal), [client]);
  const { value, failed, retry } = usePublicRead('service-info', read);
  const { hash } = useLocation();
  useEffect(() => {
    if (!['#rules', '#privacy', '#disclaimer', '#operator', '#contact'].includes(hash)) return;
    const heading = document.getElementById(hash.slice(1));
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <article className="shell about prose service-info">
      <h1>利用ルールと情報の扱い</h1>
      <p>学校の学びや制作を、記事・作品で共有する場所です。学校公式のサービスではありません。</p>
      <section className="service-info-summary" aria-labelledby="summary">
        <h2 id="summary">要点</h2>
        <ul role="list">
          <li>
            <Icon name="globe" size={18} />
            <span>
              <strong>公開されるもの：</strong>
              自分で確認したプロフィール、公開した記事・作品と画像、記事へのいいね一覧。
            </span>
          </li>
          <li>
            <Icon name="lock" size={18} />
            <span>
              <strong>一般に公開しないもの：</strong>
              学校メール、入学・卒業予定年度、下書き、未公開の画像
              {authoringUiEnabled ? '、閲覧履歴' : ''}
              。運営は改善や安全の確保のために確認・分析することがあります（外部のAIサービスによる処理を含む）。
            </span>
          </li>
          <li>
            <Icon name="pencil" size={18} />
            <span>
              <strong>投稿するとき：</strong>
              自分の学び・制作を自分で確かめて書く。他の人の個人情報や、許可なく使えない文章・画像は載せない。
            </span>
          </li>
          <li>
            <Icon name="alert" size={18} />
            <span>
              <strong>困ったとき：</strong>
              削除・個人情報・運営の判断への相談は<a href="#contact">問い合わせ</a>へ。
            </span>
          </li>
        </ul>
        <p>以下が正式な内容です。</p>
      </section>
      <nav className="service-info-links" aria-label="この案内の内容">
        <a href="#rules">利用ルール</a>
        <a href="#privacy">情報の扱い</a>
        <a href="#disclaimer">免責事項</a>
        <a href="#operator">運営者</a>
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
          <li>
            口コミなど他の人の文章は、自分の文章が主になる範囲で短く引用し、出典を書いてください。他の人の写真・画像（Google
            マップに投稿された写真を含む）はアップロードし直さず、公式の埋め込みかリンクで紹介してください。
          </li>
          <li>課題で考えたことや学びは共有できます。解答の丸写しは掲載しないでください。</li>
        </ul>
        <p>
          投稿には学校Googleでのログインが必要です。卒業予定年度を過ぎると、新規投稿はできません。
        </p>
        <p>
          卒業後も公開済みの内容は自動で削除しません。ログインできる間は、本人による年度訂正・下書きの整理・公開停止を続けられます。学校Googleを使えなくなった場合は窓口へ相談してください。本人確認なしに権限を復旧したり、非公開情報を開示したりすることはありません。
        </p>
        <details className="service-info-more">
          <summary>本人確認の詳しい扱い</summary>
          <p>
            本人の依頼として非公開情報を変更する場合は、有効なログイン中の本人操作か、同じ学校Googleでの再ログインを確認します。確認できない場合は処理を保留し、メールアドレスや公開URLだけでは本人と判断しません。公開済み個人情報の問題は別に内容を確認し、運営が必要な非公開を判断します。
          </p>
        </details>
      </section>
      <section>
        <h2 id="privacy" tabIndex={-1}>
          公開する情報・自分だけの情報
        </h2>
        <dl>
          <dt>読者に公開されるもの</dt>
          <dd>
            自分で確認した表示名・学科・学年・自己紹介、自分で載せたプロフィールのリンク（X・GitHub・LinkedIn・Webサイト）、公開した記事・作品と画像、記事へのいいね一覧です。
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
          {
            'どの画面がどこから来た人にどれだけ読まれているかを知るため、閲覧した画面の種類（記事・作品はそのID）、来たサイトの名前とURLのutm_の値、記事・作品をどこまで・何秒読んだか、スマホかPCか、ページを開くたびに作るランダムな識別子（ブラウザに保存しません）を、Cloudflareに送って集計します。アカウント・メール・IPアドレス・検索語とは結びつけません。ブラウザの「トラッキングしない」（Do Not Track・Global Privacy Control）が有効なら送りません。'
          }
        </p>
        <p>
          運営は、サービスの提供・改善と安全の確保（通報や不正への対応を含む）のために、非公開の情報を含む利用者のデータを確認・分析することがあります。外部のAIサービスを使って処理する場合を含みます。非公開の情報を、本人の同意なく公開することはありません。
        </p>
        <p>
          {authoringUiEnabled ? (
            <>
              ログイン中に読んだ記事・作品は、本人だけが見られる<Link to="/history">閲覧履歴</Link>
              に残ります。保存するのは参照先と最後に読んだ日時だけです。記録を停止でき、1件ずつ・すべての削除ができます。自動削除は行いません。上限500件に達すると新しい対象を記録しません。公開停止された内容の題名や画像は履歴に表示しません。
            </>
          ) : (
            'アプリ内の閲覧履歴は記録していません。'
          )}
          YouTube・Instagram・Google マップの埋め込みは「読み込む」を押してから外部に接続します。
        </p>
        <p>
          公開停止すると新しい閲覧から外れます。停止はデータ全体の消去や、すでに読者に届いた内容の回収ではありません。
        </p>
        <p>
          公開した記事・作品は、Google
          などの検索エンジンの検索結果に表示されることがあります。表示を止めるには公開停止してください。検索結果から消えるまでには時間がかかることがあります。学生のページ・検索結果・下書きは検索エンジンに載せません。
        </p>
        <details className="service-info-more">
          <summary>ログイン記録の整理と消去の限界</summary>
          <p>
            ログイン用の一時記録は有効期限で利用を拒否し、期限から24時間の猶予後に少量ずつ整理しますが、バックアップを含む消去時刻を保証するものではありません。
          </p>
        </details>
      </section>
      <section aria-labelledby="disclaimer">
        <h2 id="disclaimer" tabIndex={-1}>
          免責事項
        </h2>
        <ul>
          <li>
            記事・作品は、それぞれの投稿者が自分の責任で公開したものです。運営は内容を事前に確認しておらず、正確性・完全性・最新性・有用性・安全性を保証しません。
          </li>
          <li>
            手順・コード・授業や課題・進路・学校生活・お店などの情報を参考にするときは、自分の判断と責任で行い、学校の公式情報や先生・公式窓口などで確かめてください。
          </li>
          <li>
            掲載内容は投稿者個人の考えであり、学校の公式見解ではなく、運営の見解を示すものでもありません。
          </li>
          <li>
            外部サイトへのリンクや埋め込み（YouTube・Instagram・Google マップ
            など）の先の内容・サービスについて、運営は責任を負いません。プロフィールのリンクは投稿者が自分で載せたもので、運営はリンク先が本人のものかを確かめていません。
          </li>
          <li>
            サイトの内容・機能は予告なく変更・一時停止・終了することがあります。投稿や画像の保存、サービスの継続を保証しないため、大切な文章や画像は手元にも残してください。
          </li>
          <li>
            あなたが接続したAIエージェントの操作（下書きの作成、公開済みの記事の直しなど）は、あなた自身の操作として扱います。その内容と結果は、あなたの責任です。
          </li>
          <li>
            運営は、利用ルールに反する、またはそのおそれがあると判断した内容・アカウントについて、事前に通知せず、公開停止・利用の制限などの措置をとることがあります。運営の作業（通報への対応、アカウントへの措置、この案内の改定など）の一部は、AIを用いて行うことがあります。
          </li>
          <li>
            利用者どうしの間で生じたやり取りやトラブルは、当事者の間で解決してください。運営は、利用ルールに反する内容の通報への対応など、運営の判断で必要と考える範囲で対応します。
          </li>
          <li>
            このサイトの利用、利用できなかったこと、運営の措置、データの消失・変更、AIエージェントやAIを用いた処理によって生じた損害について、運営は、法令上責任を負う場合を除き、責任を負いません。
          </li>
        </ul>
        <p>
          この免責事項と利用ルールは、必要に応じて変更することがあります。変更後の内容は、このページに掲載した時点から適用します。
        </p>
        <p className="service-info-updated">最終更新：2026年11月28日</p>
      </section>
      <section aria-labelledby="operator">
        <h2 id="operator" tabIndex={-1}>
          運営者
        </h2>
        <dl>
          <dt>運営</dt>
          <dd>Kobe Student Hub 運営委員会</dd>
          <dt>位置づけ</dt>
          <dd>
            学生有志による非公式のサイトです。神戸電子専門学校が運営・監修・承認するものではありません。
          </dd>
          <dt>連絡先</dt>
          <dd>
            下の<a href="#contact">問い合わせ</a>から連絡してください。
          </dd>
        </dl>
      </section>
      <section aria-labelledby="contact">
        <h2 id="contact" tabIndex={-1}>
          問い合わせ・異議申立て
        </h2>
        <p>
          運営判断への相談、削除や個人情報の修正についての案内です。卒業後など、学校Googleを使えなくなった場合も、この案内を確認してください。
        </p>
        <p>機能の要望も、この窓口で受け付けています。</p>
        {failed ? (
          <div role="alert">
            <p>問い合わせ先を確認できませんでした。</p>
            <Button className="primary" onClick={retry}>
              問い合わせ先を再読み込み
            </Button>
          </div>
        ) : !value ? (
          <p role="status" className="sr-only">
            問い合わせ先を確認しています…
          </p>
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
    </article>
  );
}

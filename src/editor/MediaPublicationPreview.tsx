import { referencedMediaIds } from '../shared/media';
import PrivateImage from './PrivateImage';
export default function MediaPublicationPreview({
  body,
  fetcher,
  scopeKey,
}: {
  body: string;
  fetcher: typeof fetch;
  scopeKey: string;
}) {
  const ids = referencedMediaIds(body);
  if (!ids.length) return null;
  return (
    <section aria-label="公開する画像の確認">
      <h4>この保存版と一緒に公開する画像：{ids.length}枚</h4>
      <p>
        本文に参照した画像は、コードやリンクとして書いた参照も含め、匿名の読者が取得できるようになります。個人情報や他の人の写り込みを確認してください。
      </p>
      {ids.length > 8 ? (
        <p role="alert">公開できる画像は8枚までです。参照を減らして保存してください。</p>
      ) : (
        <div className="media-grid">
          {ids.map((id) => (
            <figure key={id}>
              <PrivateImage id={id} alt="公開前の画像" fetcher={fetcher} scopeKey={scopeKey} />
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

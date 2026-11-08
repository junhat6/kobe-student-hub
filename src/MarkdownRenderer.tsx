import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock';
import PrivateImage from './editor/PrivateImage';
import { mediaId } from './shared/media';
import './editor/media.css';
import YouTubeEmbed from './YouTubeEmbed';
import { youtubeVideoId } from './shared/youtube';
export default function MarkdownRenderer({
  body,
  privateMedia,
}: {
  body: string;
  privateMedia?: { fetcher: typeof fetch; scopeKey: string };
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      skipHtml
      components={{
        p: ({ node, children }) => {
          const child = node?.children.length === 1 ? node.children[0] : null;
          const id =
            child?.type === 'element' && child.tagName === 'a'
              ? youtubeVideoId(child.properties.href)
              : null;
          return id ? <YouTubeEmbed key={id} videoId={id} /> : <p>{children}</p>;
        },
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        a: ({ href, children }) => (
          <a href={href && /^https?:\/\//.test(href) ? href : undefined} rel="noopener noreferrer">
            {children}
          </a>
        ),
        img: ({ src, alt }) => {
          const id =
            typeof src === 'string' && src.startsWith('/api/media/')
              ? src.slice('/api/media/'.length)
              : null;
          if (!mediaId(id)) return null;
          return privateMedia ? (
            <PrivateImage id={id} alt={alt ?? ''} {...privateMedia} />
          ) : (
            <img
              className="content-image"
              src={'/api/media/' + id}
              alt={alt ?? ''}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          );
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

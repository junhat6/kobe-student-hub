import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
export default function MarkdownRenderer({body}:{body:string}){
 return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} skipHtml components={{a:({href,children})=><a href={href&&/^https?:\/\//.test(href)?href:undefined} rel="noopener noreferrer">{children}</a>,img:()=>null}}>{body}</ReactMarkdown>;
}

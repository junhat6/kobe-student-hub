import { Button } from '@base-ui/react/button';
import { SHOP_REVIEW_RULES } from '../agent/article-format';

/** Tag examples the 北野川線沿い×ごはん entry point counts (DECISIONS 2026-11-22). */
export const SHOP_REVIEW_TAGS = ['ごはん', '北野川線沿い'] as const;

/** Body skeleton for a hand-written shop review: when, what and how much, and student-facing points. */
export const SHOP_REVIEW_TEMPLATE = `## 行った時期とお店

## 頼んだもの・値段（その時点）

## 学生向けのポイント
- 昼休みに間に合うか：
- 一人で入りやすいか：
`;

/** Appends the skeleton after the current body; never replaces what the writer already wrote. */
export const withShopReviewTemplate = (body: string) =>
  body.trim() ? body.replace(/\s*$/, '') + '\n\n' + SHOP_REVIEW_TEMPLATE : SHOP_REVIEW_TEMPLATE;

/**
 * Folded guide for students who hand-write a shop review. Closed by default so ordinary articles
 * do not carry it; the agent request carries the same rules from SHOP_REVIEW_RULES.
 */
export default function ShopReviewGuide({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: () => void;
}) {
  return (
    <details className="shop-review-guide">
      <summary>お店のレビューを書くとき</summary>
      <div className="shop-review-guide-body">
        <p>
          タグの例：
          {SHOP_REVIEW_TAGS.map((tag) => (
            <code key={tag}>{tag}</code>
          ))}
        </p>
        <h4>決まり</h4>
        <ul>
          {SHOP_REVIEW_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <h4>本文の型</h4>
        <p>行った時期、頼んだものとその時点の値段、昼休みに間に合うか・一人で入りやすいか。</p>
        <Button disabled={disabled} onClick={onInsert}>
          本文の末尾に型を入れる
        </Button>
      </div>
    </details>
  );
}

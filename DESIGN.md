# Kobe Student Hub — Design

## 基準と優先順位

PRDの「記事・作品から学生の知識・経験・活動に出会う」を優先する。Zennの情報構成や機能をそのまま複製しない。学生一覧を主役にせず、記事・作品から投稿者へ自然につなげる。

視覚参考: [awesome-design-md-jp / Zenn DESIGN.md](https://github.com/kzhrknt/awesome-design-md-jp/blob/main/design-md/zenn/DESIGN.md)。2026-11-03参照、対象blob `4e8af0341d989a921132a4e688889fe19edf7f6d`。実サイトから抽出された非公式資料であり、Zenn公式の仕様・提携ではない。ロゴ、固有のブランド名称、画像は流用しない。ライセンスは下記に収録。

## 色と文字

| 役割 | 値 | 用途 |
| --- | --- | --- |
| ブランドアクセント | `#3ea8ff` | アイコン、アクティブの線、ボタン背景 |
| 読める青 | `#076db3` | 小さいリンク、ホバー背景＋白文字 |
| 主文字 | `rgba(0,0,0,.82)` | 見出し、本文 |
| 補足文字 | `#596e7d` | 日付、説明、メタデータ |
| 白 | `#ffffff` | カード、ヘッダー |
| 面 | `#f1f5f9` | フィード背景 |
| 境界 | `#d6e3ed` | 入力欄、カード、区切り |

#3ea8ffと白は通常の小さい文字で十分なコントラストにならないため、青背景のボタンは濃い `#10283f` 文字を使う。hoverは `#076db3`＋白。リンクは濃い青。参照の見た目より可読性を優先する。

システムフォントを用い、外部フォントの通信を不要にする。`-apple-system, system-ui, Hiragino Kaku Gothic ProN, Hiragino Sans, Meiryo, sans-serif`。本文16px、行高1.8、字詰めなし。コード14px、`SFMono-Regular, Consolas, Menlo, monospace`。補足は原則12px以上。モバイルの検索入力も16px。

## レイアウトと操作

- 白いカード、12px角丸。入力とボタン8px角丸。線で区切り、影は控えめ。
- 余白は4、8、16、24、32、48pxを基本とする。
- PCは記事・作品の2列と補助サイドバー。スマホは1列、補助情報を減らす。
- 記事では想定読者・前提知識・読後にわかることを本文の前に置く。
- タイトル、タグ、投稿者、関連する記事・作品を明示的なリンクにする。
- 本文の長いコードは横スクロールに閉じ込め、画面全体をはみ出させない。
- 操作対象は44pxを目安に確保。キーボードfocus、本文へのスキップ、入力label、検索0件・読み込み失敗と再試行を用意。
- 未実装機能を動くように見せない。架空サンプルと開発中であることを常に伝える。
- 色だけで状態を伝えず、選択状態はaria-pressed等にも反映。motion削減設定に従う。

## License for reference material

MIT License

Copyright (c) 2026 awesome-design-md-jp contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

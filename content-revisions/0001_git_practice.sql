-- Public fictional sample editorial revision only; no schema/auth/ledger change.
-- Compare the exact previous text so changed/real/private rows are never overwritten.
UPDATE content SET body = '# 作業を分けて、試してみる

これは体験確認用の架空の記事です。

commitは、ある時点の変更を記録するものです。ブランチは、その記録の流れに名前をつけて作業を分けるために使えます。

## 練習用のリポジトリで試す

最初のcommitを済ませた、自分専用の練習用リポジトリを開きます。README.mdが追跡済みで、作業途中の変更がない状態を想定しています。次の手順を順番に進めます。

### 1. ブランチを作る

```bash
git switch -c try-new-title
```

### 2. README.mdを編集して保存する

エディターでREADME.mdを開き、先頭の見出しを練習用の内容に変更して保存します。ここはエディターで行う手作業です。保存してから次へ進みます。

### 3. 変更を確認して記録する

まず、自分が変更した見出しが差分に出ることを確認します。

```bash
git diff -- README.md
```

差分が自分の変更と一致したら、次のコマンドで記録します。

```bash
git add README.md
git commit -m "タイトルを試す"
```

元の作業に戻る前に、変更をcommitしておきましょう。

## 気をつけること

共有するリポジトリでは、チームのルールを確認してから操作してください。この例は自分の練習用リポジトリを想定しています。' WHERE id = 'git-branches' AND is_sample = 1 AND status = 'published' AND body = '# 作業を分けて、試してみる

これは体験確認用の架空の記事です。

commitは、ある時点の変更を記録するものです。ブランチは、その記録の流れに名前をつけて作業を分けるために使えます。

## 練習用のリポジトリで試す

```bash
git switch -c try-new-title
# ファイルを編集して保存
git add README.md
git commit -m "タイトルを試す"
```

元の作業に戻る前に、変更をcommitしておきましょう。

## 気をつけること

共有するリポジトリでは、チームのルールを確認してから操作してください。この例は自分の練習用リポジトリを想定しています。';

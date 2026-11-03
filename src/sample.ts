import type { Catalog } from './types';
// Fictional examples, not student records or school teaching materials.
export const sampleCatalog: Catalog = {
  mode: 'sample',
  profiles: [
    {id:'sample-a',name:'サンプルの先輩',department:'IT分野',year:'2年相当',bio:'架空の投稿者です。小さくつくりながら、わかったことを言葉にする練習をしています。',initials:'先'},
    {id:'sample-b',name:'サンプルの学生',department:'IT分野',year:'1年相当',bio:'架空の投稿者です。日々の制作や、試してみたことを記録します。',initials:'学'}
  ],
  entries: [
    {id:'learning-notes',kind:'article',title:'「動いた」で終わらせない、制作ノートの残し方',summary:'あとから自分に説明できるように。小さな記録が、次の制作の助けになった話。',body:'# ひとことだけ、理由を残す\n\nこれは体験確認用の架空の記事です。実際の授業や学生の経験を記録したものではありません。\n\nコードが動いたら、次の3つを自分の言葉で書いてみます。\n\n1. 何をつくろうとしたか\n2. どこで迷い、何を試したか\n3. 次に同じことをするとき、何を変えるか\n\n## 完璧なノートにしなくていい\n\nまずは「なぜこれで動いたと思うか」を一文だけ残します。説明できないところは、次に調べることの目印になります。\n\n> 自分の条件に合うところだけ、試してみてください。\n\n## 今日の一歩\n\n最近書いたコードをひとつ選んで、動く理由を一文で説明してみましょう。',tags:['学び方','制作'],authorId:'sample-a',audience:'これから個人制作を始める人',prerequisite:'簡単なプログラムを動かしたことがある',outcome:'制作を振り返るための3つの問い',updatedAt:'2026-11-03',minutes:3,relatedIds:['tiny-notes']},
    {id:'git-branches',kind:'article',title:'commitの次に知りたい、ブランチの考え方',summary:'変更を記録できるようになった人へ。「別の作業を試す場所」として考えてみる。',body:'# 作業を分けて、試してみる\n\nこれは体験確認用の架空の記事です。\n\ncommitは、ある時点の変更を記録するものです。ブランチは、その記録の流れに名前をつけて作業を分けるために使えます。\n\n## 練習用のリポジトリで試す\n\n```bash\ngit switch -c try-new-title\n# ファイルを編集して保存\ngit add README.md\ngit commit -m "タイトルを試す"\n```\n\n元の作業に戻る前に、変更をcommitしておきましょう。\n\n## 気をつけること\n\n共有するリポジトリでは、チームのルールを確認してから操作してください。この例は自分の練習用リポジトリを想定しています。',tags:['Git','チーム開発'],authorId:'sample-a',audience:'addとcommitを使ったことがある人',prerequisite:'ファイルの変更をGitで記録できる',outcome:'ブランチを使って作業を分ける理由',updatedAt:'2026-11-02',minutes:4,relatedIds:[]},
    {id:'tiny-notes',kind:'project',title:'ひとこと制作ノート',summary:'制作で気づいたことを、一行ずつ残す。振り返りを続けるための小さなアプリのアイデア。',body:'# つくりたいもの\n\n体験確認のための架空の作品です。実在する公開アプリやGitHubリポジトリではありません。\n\n毎日の制作で「今日試したこと」と「次にやること」を短く記録するアプリを想定しています。\n\n## 工夫したいところ\n\n- スマホからすぐに一行を書ける\n- あとでテーマごとに読み返せる\n- できたことだけでなく、迷ったことも残せる\n\n## 次に試したいこと\n\nノートを残すまでの操作が少なくなると、続けやすいかを確かめたいです。',tags:['制作','Webアプリ'],authorId:'sample-b',audience:'他の学生の制作からヒントを得たい人',prerequisite:'特になし',outcome:'小さな作品の着想と工夫',updatedAt:'2026-11-01',minutes:2,relatedIds:['learning-notes']},
    {id:'first-team',kind:'article',title:'チーム制作を始める前に、話しておきたい3つのこと',summary:'使う技術の前に、困ったときの相談や作業の分け方を決めてみる。',body:'# 作業する前の短い相談\n\nこれは体験確認用の架空の記事です。学校の公式な指導や授業内容ではありません。\n\n## 1. 何を完成と呼ぶか\n\n誰の、どんな場面で役立つものにしたいかを、一文にします。\n\n## 2. 困ったらどう伝えるか\n\n詰まったことを短く共有できる場所と、相談する目安を話します。\n\n## 3. いつ一緒に動かしてみるか\n\n最後に全部をつなぐのではなく、小さく動くところを早めに見せ合います。\n\nチームの条件によって合う方法は変わります。自分たちに必要な問いを選んでください。',tags:['チーム開発','経験談'],authorId:'sample-b',audience:'初めてチームで作品をつくる人',prerequisite:'特になし',outcome:'制作前に相談する3つの観点',updatedAt:'2026-10-31',minutes:3,relatedIds:['git-branches']}
  ]
};

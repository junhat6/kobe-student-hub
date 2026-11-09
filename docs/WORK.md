# Current work

- 12時間の目標：2026-11-09 16:25 JST。実装・統合・本番反映を優先し、検証詳細はPRへ集約する。
- 現在地：実Googleがfragment指定でもqueryへ返すため登録未完了。本番OAuthを閉じ、[form_post修正 #120](https://github.com/junhat6/kobe-student-hub/pull/120)を準備。投稿も未開放。
- 価値仮説：学校Google登録・年度管理を成立させ、余計な手続きなく制作物を投稿できるようにする。本人限定の旧試用機能は撤去済み。
- 検証・次の実行：#120の独立QA・実platform確認と統合831 unitを完了。最終green CI後にaccount-onlyを反映し、実Google登録を確認。同時session確認の誤sign-outも修正。詳細はPRへ集約する。
- 投稿候補[#119](https://github.com/junhat6/kobe-student-hub/pull/119)は認証修正を統合し、PC/mobile104・別context8を確認。session修正を統合中。実operator設定、通知・問い合わせ設定後に開放する。認証整理cronは設置済みで、開始を観測。完了件数や物理消去は未確認。
- PRD原文・恒久的なsecurity条件は変更しない。過去の作業履歴はGitと各PRを参照する。

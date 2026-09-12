# 生产装配

下面展示依赖装配关系。密钥只放后端环境变量。

```ts
import { TosClient } from "@volcengine/tos-sdk";
import {
  ArkStructuredJsonModel,
  ChapterIllustrationAgent,
  JsonNovelChapterAnalyzer,
  JsonVisionIllustrationReviewer,
  PostgresIllustrationRepository,
  Seedream45ImageGenerator,
  TosAssetStorage,
} from "novel-illustration-agent";

const repository = PostgresIllustrationRepository.fromConnectionString(
  process.env.DATABASE_URL!,
);

const tosClient = new TosClient({
  accessKeyId: process.env.TOS_ACCESS_KEY_ID!,
  accessKeySecret: process.env.TOS_ACCESS_KEY_SECRET!,
  region: process.env.TOS_REGION!,
  endpoint: process.env.TOS_ENDPOINT!,
});

const storage = new TosAssetStorage(tosClient, {
  bucket: process.env.TOS_BUCKET!,
  publicBaseUrl: process.env.TOS_PUBLIC_BASE_URL,
});

const analysisModel = new ArkStructuredJsonModel({
  apiKey: process.env.ARK_API_KEY!,
  model: process.env.ARK_TEXT_MODEL!,
});

const reviewModel = new ArkStructuredJsonModel({
  apiKey: process.env.ARK_API_KEY!,
  model: process.env.ARK_VISION_MODEL!,
});

const agent = new ChapterIllustrationAgent(
  repository,
  new JsonNovelChapterAnalyzer(analysisModel),
  new Seedream45ImageGenerator({
    apiKey: process.env.SEEDREAM_API_KEY!,
    model: process.env.SEEDREAM_MODEL ?? "doubao-seedream-4.5",
  }),
  storage,
  new JsonVisionIllustrationReviewer(reviewModel),
);
```

注意：示例中的官方 TOS SDK 由宿主项目选择和审计版本，本包不会强制安装它。私有桶未配置 `publicBaseUrl` 时，`TosAssetStorage.getDisplayUrl()` 会返回短时签名 URL。

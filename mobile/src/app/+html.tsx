import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { ReactNode } from 'react';

const DEFAULT_SHARE_ORIGIN = 'https://onepick-5cl.pages.dev';
const DEFAULT_TITLE = 'OnePick | 나의 원픽으로 취향을 보여주세요';
const DEFAULT_DESCRIPTION = '카테고리마다 하나의 원픽을 고르고, 한줄평과 함께 나의 취향을 보여주세요.';

function shareOrigin() {
  return process.env.EXPO_PUBLIC_SHARE_BASE_URL?.trim().replace(/\/+$/, '') || DEFAULT_SHARE_ORIGIN;
}

export default function Root({ children }: { children: ReactNode }) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  const imageUrl = `${shareOrigin()}/og-default.png`;

  return (
    <html {...htmlAttributes} lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>{DEFAULT_TITLE}</title>
        <meta name="description" content={DEFAULT_DESCRIPTION} />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OnePick" />
        <meta property="og:title" content={DEFAULT_TITLE} />
        <meta property="og:description" content={DEFAULT_DESCRIPTION} />
        <meta property="og:image" content={imageUrl} />
        <meta property="og:image:alt" content="OnePick" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={DEFAULT_TITLE} />
        <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
        <meta name="twitter:image" content={imageUrl} />

        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
